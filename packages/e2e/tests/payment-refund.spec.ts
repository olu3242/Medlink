import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signInWithMagicLink } from "../lib/auth";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const webUrl = process.env.MEDLINK_E2E_WEB_URL ?? "http://localhost:3004";
const providerUrl = process.env.MEDLINK_E2E_PROVIDER_URL ?? "http://127.0.0.1:4010";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const paymentWebhookSecret = process.env.MEDLINK_E2E_PAYMENT_WEBHOOK_SECRET
  ?? "medlink-e2e-payment-webhook-secret-0001";
const paymentRefundWorkerToken = process.env.MEDLINK_E2E_PAYMENT_REFUND_WORKER_TOKEN
  ?? "medlink-e2e-payment-refund-worker-token-0001";
const supabaseUrl = process.env.MEDLINK_E2E_SUPABASE_URL ?? "";
const supabaseServiceKey = process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY ?? "";

const SYSTEM_IDENTITY = "11111111-1111-4111-8111-111111111111";

interface PaymentAttempt {
  readonly paymentId: string;
  readonly attemptId: string;
  readonly providerReference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly hostedPaymentUrl: string;
}

function postSignedEvent(
  request: APIRequestContext,
  event: Readonly<Record<string, unknown>>,
) {
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", paymentWebhookSecret).update(raw, "utf8").digest("hex");
  return request.post(`${webUrl}/api/payments/webhook`, {
    headers: { "Content-Type": "application/json", "x-medlink-payment-signature": `sha256=${signature}` },
    data: raw,
  });
}

// Certifies the payment convergence gap 202608170059 left open: the only
// path that can move a *paid* reservation out of confirmed/ready is the
// system expiry worker (release_expired_inventory_holds); until
// 202608170060, nothing ever refunded or even flagged that captured
// amount. Setup is fixture-seeded (certify_payment_refund_fixture) since
// the MAR/pharmacist/browser pipeline that produces a confirmed,
// payment-required reservation is already certified end to end by
// golden-loop.spec.ts -- this suite certifies the new refund path alone:
// trigger -> outbox -> provider -> signed confirmation webhook, the same
// shape as capture itself.
test("a captured payment refunds when its reservation expires unclaimed", async ({ page, request }) => {
  test.setTimeout(60_000);
  const service = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `payment-refund-${nonce}@medlink.test`;
  const created = await service.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("could not create patient");
  const patientId = created.data.user.id;

  const { data: fixtureData, error: fixtureError } = await service.rpc("certify_payment_refund_fixture", {
    fixture_key: nonce,
    patient_id: patientId,
  });
  expect(fixtureError, JSON.stringify(fixtureError)).toBeNull();
  const fixture = fixtureData as { reservationId: string };

  await signInWithMagicLink(page, patientUrl, mailpitUrl, email);

  const createResponse = await page.request.post(`${patientUrl}/api/v1/payments`, {
    headers: { "Content-Type": "application/json" },
    data: { reservationId: fixture.reservationId, idempotencyKey: `payment-${fixture.reservationId}` },
  });
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const attempt = (await createResponse.json() as { data: PaymentAttempt }).data;
  expect(attempt.amountMinor).toBe(250000);

  const captured = await postSignedEvent(page.request, {
    eventId: `success-${attempt.attemptId}`,
    providerReference: attempt.providerReference,
    status: "succeeded",
    amountMinor: attempt.amountMinor,
    currency: attempt.currency,
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const { data: capturedPayment, error: capturedPaymentError } = await service
    .from("payments").select("status").eq("id", attempt.paymentId).single();
  expect(capturedPaymentError, JSON.stringify(capturedPaymentError)).toBeNull();
  expect(capturedPayment?.status).toBe("captured");

  // Deterministic, not wall-clock-dependent: the fixture already seeded the
  // inventory lock past its own expires_at (while the reservation itself
  // stays eligible for payment), so this is the same real worker RPC an
  // external scheduler would eventually call, invoked directly.
  const { data: expiry, error: expiryError } = await service.rpc(
    "release_expired_inventory_holds", { target_limit: 25 },
  );
  expect(expiryError, JSON.stringify(expiryError)).toBeNull();
  expect((expiry as { releasedHolds: number }).releasedHolds).toBeGreaterThanOrEqual(1);
  const { data: expiredReservation, error: expiredReservationError } = await service
    .from("reservations").select("status").eq("id", fixture.reservationId).single();
  expect(expiredReservationError, JSON.stringify(expiredReservationError)).toBeNull();
  expect(expiredReservation?.status).toBe("expired");

  const { data: refund, error: refundError } = await service
    .from("refunds")
    .select("id,status,amount_minor,provider_refund_reference,initiated_by")
    .eq("payment_id", attempt.paymentId)
    .single();
  expect(refundError, JSON.stringify(refundError)).toBeNull();
  expect(refund).toMatchObject({
    status: "pending",
    amount_minor: 250000,
    initiated_by: SYSTEM_IDENTITY,
  });
  expect(refund?.provider_refund_reference).toContain(refund!.id);

  // A second pass over the same, already-expired reservation must not
  // create a duplicate refund obligation.
  const { data: secondPass } = await service.rpc(
    "release_expired_inventory_holds", { target_limit: 25 },
  );
  expect((secondPass as { releasedHolds: number }).releasedHolds).toBe(0);
  const { count: refundCount } = await service
    .from("refunds").select("id", { count: "exact", head: true }).eq("payment_id", attempt.paymentId);
  expect(refundCount).toBe(1);

  // Advance the payment-refund worker: this is what actually calls the
  // provider (packages/payments/src/refund-dispatch.ts), the same
  // outbox/claim mechanism apps/web's notification worker already uses.
  const dispatchResponse = await request.post(`${webUrl}/api/internal/payment-refund-dispatch`, {
    headers: { Authorization: `Bearer ${paymentRefundWorkerToken}` },
    data: { limit: 25 },
  });
  expect(dispatchResponse.status(), await dispatchResponse.text()).toBe(200);

  const refundsAtProvider = await request.get(`${providerUrl}/payments/refunds`);
  const providerRefunds = (await refundsAtProvider.json() as {
    refunds: ReadonlyArray<{ reference: string; amountMinor: number; currency: string }>;
  }).refunds;
  const providerRefund = providerRefunds.find(
    (entry) => entry.reference === refund!.provider_refund_reference,
  );
  expect(providerRefund).toMatchObject({ amountMinor: 250000, currency: "NGN" });

  const refundConfirmation = await postSignedEvent(request, {
    eventId: `refund-success-${refund!.id}`,
    providerRefundReference: refund!.provider_refund_reference,
    status: "succeeded",
    amountMinor: 250000,
    currency: "NGN",
  });
  expect(refundConfirmation.status(), await refundConfirmation.text()).toBe(200);

  const { data: settledRefund, error: settledRefundError } = await service
    .from("refunds").select("status,completed_at").eq("id", refund!.id).single();
  expect(settledRefundError, JSON.stringify(settledRefundError)).toBeNull();
  expect(settledRefund?.status).toBe("succeeded");
  expect(settledRefund?.completed_at).not.toBeNull();
  const { data: settledPayment, error: settledPaymentError } = await service
    .from("payments").select("status").eq("id", attempt.paymentId).single();
  expect(settledPaymentError, JSON.stringify(settledPaymentError)).toBeNull();
  expect(settledPayment?.status).toBe("refunded");

  // Replaying the exact same signed provider event a second time must not
  // double-apply -- apply_refund_provider_event's own provider-event
  // dedup guard, mirroring apply_payment_provider_event's.
  const replay = await postSignedEvent(request, {
    eventId: `refund-success-${refund!.id}`,
    providerRefundReference: refund!.provider_refund_reference,
    status: "succeeded",
    amountMinor: 250000,
    currency: "NGN",
  });
  expect(replay.status(), await replay.text()).toBe(200);
  const replayBody = await replay.json() as { data: { outcome: string } };
  expect(replayBody.data.outcome).toBe("duplicate");
});
