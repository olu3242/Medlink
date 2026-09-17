import { HostedPaymentProvider } from "@medlink/payments";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PaymentAttemptProjection {
  readonly paymentId: string;
  readonly attemptId: string;
  readonly providerReference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly attemptStatus: string;
}

export async function listPatientPayments(
  database: SupabaseClient,
  context: RuntimeContext,
) {
  const { data, error } = await database.from("payments")
    .select("id,reservation_id,amount_minor,currency_code,status,reconciliation_required,payment_attempts(id,status,provider_reference,created_at)")
    .eq("organization_id", context.organizationId)
    .eq("patient_id", context.userId)
    .order("created_at", { ascending: false });
  if (error) throw new RuntimeError(
    "infrastructure", "database_operation_failed", "Payments could not be loaded", 503, true,
  );
  return data ?? [];
}

export async function createPatientPaymentAttempt(
  database: SupabaseClient,
  context: RuntimeContext,
  input: { readonly reservationId: string; readonly idempotencyKey: string },
) {
  const providerUrl = process.env.MEDLINK_PAYMENT_PROVIDER_URL;
  const providerKey = process.env.MEDLINK_PAYMENT_PROVIDER_KEY;
  if (!providerUrl || !providerKey) throw new RuntimeError(
    "infrastructure", "payment_provider_not_configured",
    "Payment is temporarily unavailable", 503, true, "Retry later.",
  );
  const { data, error } = await database.rpc("create_payment_attempt", {
    target_organization_id: context.organizationId,
    target_actor_id: context.userId,
    target_reservation_id: input.reservationId,
    target_provider: "deterministic-simulator",
    target_idempotency_key: input.idempotencyKey,
    target_correlation_id: context.correlationId,
    target_request_id: context.requestId,
  });
  if (error) throw new RuntimeError(
    "infrastructure", "payment_attempt_failed",
    "Payment could not be started", 503, true, "Retry later.", { cause: error },
  );
  const attempt = data as PaymentAttemptProjection;
  const hosted = await new HostedPaymentProvider(providerKey, providerUrl).createIntent({
    providerReference: attempt.providerReference,
    amount: { amountMinor: attempt.amountMinor, currency: attempt.currency },
    idempotencyKey: input.idempotencyKey,
  });
  return { ...attempt, hostedPaymentUrl: hosted.hostedPaymentUrl };
}
