import { buildReservationNotificationDispatcher } from "@medlink/notifications";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

// G09 reconciliation: same best-effort contract as
// apps/patient/lib/notification-dispatch.ts, piggybacked on the pharmacy
// side of the lifecycle (confirm/decline, ready, collect) instead of only
// reservation creation. A pharmacy action has already committed by the
// time this runs -- a WhatsApp outage or notification-store failure here
// must never turn into a failed decision/ready/collect response.
//
// Auth client convergence (authorization convergence repair, item 9): this
// used to construct its own createClient(url, serviceRoleKey, ...) instead
// of reusing apps/web/lib/supabase/service-role.ts's canonical factory. The
// pharmacy_staff/patient callers who trigger this can only ever cause the
// fixed dispatcher.dispatch() call below to run (draining the notification
// outbox) -- they never get a handle to the service-role client itself, so
// this does not change the item 10 service-role isolation boundary.
export async function dispatchPendingReservationNotifications(): Promise<void> {
  try {
    const whatsAppAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!whatsAppAccessToken) return;

    const database = createSupabaseServiceRoleClient();
    const dispatcher = buildReservationNotificationDispatcher(database, whatsAppAccessToken);
    await dispatcher.dispatch("pharmacy-reservations-worker", 5);
  } catch {
    // Swallowed deliberately -- see comment above.
  }
}
