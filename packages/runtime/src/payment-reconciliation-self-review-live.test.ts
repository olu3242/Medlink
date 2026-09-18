import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// Authorization convergence repair, item 7: certifies
// resolve_payment_reconciliation_case's self-review guard (202609180089)
// directly against the RPC, the same "direct API bypass" boundary
// clinical-review-self-review-live.test.ts certifies for item 6 -- no
// apps/web route is involved, so the guard is proven at the database layer
// itself.
//
// Drives the real state machine end to end (create_mar -> decide_clinical_review
// -> match_inventory -> reserve_inventory -> decide_reservation -> create_payment_attempt)
// via certify_medication_golden_loop_fixture (202608170041), the same fixture
// item 6's live test reuses, then forces a duplicate provider event so the
// existing capture_payment_reconciliation_event trigger opens a real
// reconciliation case -- mirroring the "duplicate_provider_transaction" path
// packages/runtime/src/network-transaction-convergence-live.test.ts already
// exercises for apply_payment_provider_event/resolve_payment_reconciliation_case,
// but through the supabase-js + MEDLINK_LIVE_SUPABASE_* boundary this file's
// sibling live tests use (the boundary CI's live-database job actually wires
// credentials into), rather than that file's raw-pg MEDLINK_CERTIFICATION_DB_URL
// boundary.
live("resolve_payment_reconciliation_case self-review guard", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;

  async function signedInUser(label: string) {
    const email = `payment-reconciliation-${label}-${nonce}@medlink.test`;
    const password = `PaymentReconciliation-${label}-${nonce}-Strong!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`fixture ${label} was not created`);
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error(`fixture ${label} could not sign in`);
    }
    return { id: created.data.user.id, client };
  }

  async function grantPlatformAdmin(userId: string) {
    const organizationId = randomUUID();
    const created = await service.from("organizations").insert({
      id: organizationId,
      name: `Reconciliation Admin Org ${nonce}-${userId.slice(0, 8)}`,
      slug: `reconciliation-admin-${nonce}-${userId.slice(0, 8)}`,
      type: "technology",
    });
    if (created.error) throw created.error;
    const membership = await service.from("organization_memberships").insert({
      organization_id: organizationId,
      user_id: userId,
      role: "platform_admin",
    });
    if (membership.error) throw membership.error;
  }

  // Drives one full golden-loop transaction through to a duplicate-provider-event
  // reconciliation case, attributed to `patient`. Returns the case id to resolve.
  async function buildReconciliationCase(fixtureKey: string, patient: { id: string; client: SupabaseClient }) {
    const pharmacist = await signedInUser(`${fixtureKey}-pharmacist`);
    const staff = await signedInUser(`${fixtureKey}-staff`);
    const { data: fixtureData, error: fixtureError } = await service.rpc("certify_medication_golden_loop_fixture", {
      fixture_key: fixtureKey,
      patient_id: patient.id,
      pharmacist_id: pharmacist.id,
      pharmacy_staff_id: staff.id,
    });
    if (fixtureError) throw fixtureError;
    const fixture = fixtureData as {
      organizationId: string; pharmacyLocationId: string; inventoryBatchId: string; marId: string; reviewId: string;
    };

    const decided = await pharmacist.client.rpc("decide_clinical_review", {
      target_organization_id: fixture.organizationId,
      target_actor_id: pharmacist.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: `${fixture.reviewId}:decide`,
      target_channel: "test",
      target_review_id: fixture.reviewId,
      target_decision: "approved",
      target_recommendation: "Proceed as prescribed",
    });
    if (decided.error) throw decided.error;

    const matched = await patient.client.rpc("match_inventory", {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: `${fixture.marId}:match`,
      target_channel: "test",
      target_mar_id: fixture.marId,
      target_inventory_batch_id: fixture.inventoryBatchId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
    });
    if (matched.error) throw matched.error;

    const reserved = await patient.client.rpc("reserve_inventory", {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: `${fixture.marId}:reserve`,
      target_channel: "test",
      target_mar_id: fixture.marId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_inventory_batch_id: fixture.inventoryBatchId,
      target_quantity: 1,
      target_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    if (reserved.error) throw reserved.error;
    const reservationId = (reserved.data as { id: string }).id;

    const confirmed = await staff.client.rpc("decide_reservation", {
      target_organization_id: fixture.organizationId,
      target_actor_id: staff.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: `${reservationId}:confirm`,
      target_channel: "test",
      target_reservation_id: reservationId,
      target_status: "confirmed",
      target_reason: null,
    });
    if (confirmed.error) throw confirmed.error;

    const attempt = await patient.client.rpc("create_payment_attempt", {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_reservation_id: reservationId,
      target_provider: "certified-simulator",
      target_idempotency_key: randomUUID(),
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
    });
    if (attempt.error) throw attempt.error;
    const { paymentId, providerReference, amountMinor } = attempt.data as {
      paymentId: string; providerReference: string; amountMinor: number;
    };

    const succeeded = await service.rpc("apply_payment_provider_event", {
      target_provider_event_reference: `${fixtureKey}-provider-event`,
      target_provider_reference: providerReference,
      target_status: "succeeded",
      target_amount_minor: amountMinor,
      target_currency_code: "NGN",
    });
    if (succeeded.error) throw succeeded.error;
    // A duplicate provider confirmation of the same payment is exactly the
    // "duplicate_provider_transaction" case capture_payment_reconciliation_event
    // already opens automatically -- no fixture invents this path.
    const duplicate = await service.rpc("apply_payment_provider_event", {
      target_provider_event_reference: `${fixtureKey}-provider-duplicate`,
      target_provider_reference: providerReference,
      target_status: "succeeded",
      target_amount_minor: amountMinor,
      target_currency_code: "NGN",
    });
    if (duplicate.error) throw duplicate.error;

    const cases = await service
      .from("payment_reconciliation_cases")
      .select("id")
      .eq("payment_id", paymentId)
      .eq("reason", "duplicate_provider_transaction");
    if (cases.error) throw cases.error;
    if (!cases.data || cases.data.length === 0) {
      throw new Error("expected a duplicate_provider_transaction reconciliation case to be opened");
    }
    return { organizationId: fixture.organizationId, paymentId, caseId: (cases.data[0] as { id: string }).id };
  }

  beforeAll(() => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  }, 60_000);

  it("allows an independent platform admin to resolve a case for someone else's payment", async () => {
    const patient = await signedInUser("indep-patient");
    const admin = await signedInUser("indep-admin");
    await grantPlatformAdmin(admin.id);
    const { caseId } = await buildReconciliationCase(`recon-indep-${nonce}`, patient);

    const resolved = await admin.client.rpc("resolve_payment_reconciliation_case", {
      target_case_id: caseId,
      target_resolution: "Duplicate evidence reviewed; single captured payment retained",
      target_evidence_reference: "provider-evidence://duplicate-transaction",
    });
    expect(resolved.error, JSON.stringify(resolved.error)).toBeNull();
    expect((resolved.data as { status: string }).status).toBe("resolved");
  }, 120_000);

  it("denies self-review when the resolving admin made the underlying payment themselves", async () => {
    const patientAdmin = await signedInUser("self-patient-admin");
    await grantPlatformAdmin(patientAdmin.id);
    const { caseId } = await buildReconciliationCase(`recon-self-${nonce}`, patientAdmin);

    const resolved = await patientAdmin.client.rpc("resolve_payment_reconciliation_case", {
      target_case_id: caseId,
      target_resolution: "Duplicate evidence reviewed; single captured payment retained",
      target_evidence_reference: "provider-evidence://duplicate-transaction",
    });
    expect(resolved.error).not.toBeNull();
    expect(resolved.error?.message).toContain("Self-review is prohibited");
  }, 120_000);
});
