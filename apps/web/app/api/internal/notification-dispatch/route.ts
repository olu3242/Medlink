import { createClient } from "@supabase/supabase-js";
import { buildReservationNotificationDispatcher } from "@medlink/notifications";
import { z } from "zod";
import { authorizedWorkerRequest } from "../../../../lib/worker-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  MEDLINK_E2E_WHATSAPP_GRAPH_API_BASE_URL: z.string()
    .regex(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
    .optional(),
  MEDLINK_NOTIFICATION_WORKER_TOKEN: z.string().min(32),
});
const inputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
}).strict();

// Dedicated, schedulable counterpart to the best-effort dispatch every
// patient/pharmacy reservation route already fires after its own request
// (see packages/notifications/src/reservation-outbox.ts's comment on
// buildReservationNotificationDispatcher): those call sites only advance
// the outbox when *some* reservation request happens to arrive
// afterward, so a pending notification can sit unprocessed indefinitely
// during a quiet period. This route lets an external scheduler advance
// the queue on a fixed cadence regardless of user traffic, using the
// same bearer-token worker pattern already established by
// /api/internal/inventory-expiry and /api/internal/clinical-pipeline.
export async function POST(request: Request) {
  const environment = environmentSchema.safeParse(process.env);
  if (!environment.success) {
    return Response.json(
      { error: { code: "notification_worker_not_configured" } },
      { status: 503 },
    );
  }
  if (!authorizedWorkerRequest(
    request,
    environment.data.MEDLINK_NOTIFICATION_WORKER_TOKEN,
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
  const dispatcher = buildReservationNotificationDispatcher(
    database,
    environment.data.WHATSAPP_ACCESS_TOKEN,
    undefined,
    environment.data.MEDLINK_E2E_WHATSAPP_GRAPH_API_BASE_URL,
  );
  await dispatcher.dispatch("scheduled-reservations-worker", parsed.data.limit);
  return Response.json({ data: { worker: "scheduled-reservations-worker", limit: parsed.data.limit } });
}
