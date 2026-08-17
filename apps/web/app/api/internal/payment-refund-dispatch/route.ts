import { createClient } from "@supabase/supabase-js";
import { buildPaymentRefundDispatcher } from "@medlink/payments";
import { z } from "zod";
import { authorizedWorkerRequest } from "../../../../lib/worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MEDLINK_PAYMENT_PROVIDER_URL: z.string().url(),
  MEDLINK_PAYMENT_PROVIDER_KEY: z.string().min(1),
  MEDLINK_PAYMENT_REFUND_WORKER_TOKEN: z.string().min(32),
});
const inputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
}).strict();

// Same bearer-token worker pattern as /api/internal/notification-dispatch:
// the reservations_refund_on_exit trigger
// (202608170060_payment_refund_on_reservation_exit.sql) enqueues
// payment.refund_required.v1 the moment a paid reservation expires, but
// nothing calls the payment provider to actually start that refund unless
// something advances the outbox. Every reservation route already
// piggybacks a best-effort dispatch of the *notification* outbox after
// its own response, but a refund is provider-driven, not request-driven --
// there is no user request happening at the moment a reservation expires --
// so this route exists so an external scheduler can advance the refund
// outbox on a fixed cadence, exactly like notification-dispatch already
// does for notifications.
export async function POST(request: Request) {
  const environment = environmentSchema.safeParse(process.env);
  if (!environment.success) {
    return Response.json(
      { error: { code: "payment_refund_worker_not_configured" } },
      { status: 503 },
    );
  }
  if (!authorizedWorkerRequest(
    request,
    environment.data.MEDLINK_PAYMENT_REFUND_WORKER_TOKEN,
  )) {
    return Response.json(
      { error: { code: "worker_authentication_required" } },
      { status: 401 },
    );
  }
  const parsed = inputSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_worker_request" } },
      { status: 400 },
    );
  }
  const database = createClient(
    environment.data.NEXT_PUBLIC_SUPABASE_URL,
    environment.data.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const dispatcher = buildPaymentRefundDispatcher(
    database,
    environment.data.MEDLINK_PAYMENT_PROVIDER_KEY,
    environment.data.MEDLINK_PAYMENT_PROVIDER_URL,
  );
  await dispatcher.dispatch("scheduled-payment-refund-worker", parsed.data.limit);
  return Response.json({ data: { worker: "scheduled-payment-refund-worker", limit: parsed.data.limit } });
}
