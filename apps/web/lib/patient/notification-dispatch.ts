import { buildReservationNotificationDispatcher } from "@medlink/notifications";
import { createSupabaseServiceRoleClient } from "../supabase/service-role";

// G09 minimum slice: best-effort only. A patient's reservation has already
// committed by the time this runs -- a WhatsApp outage, missing
// credential, or notification-store failure here must never turn into a
// failed reservation response. The event this leaves unprocessed simply
// stays pending/retrying in runtime_outbox_events for the next matching
// request to pick up (see buildReservationNotificationDispatcher's own
// comment on why there is no scheduler in this environment).
//
// Auth client convergence (authorization convergence repair, item 9): this
// used to construct its own createClient(url, serviceRoleKey, ...) instead
// of reusing apps/web/lib/supabase/service-role.ts's canonical factory. The
// patient caller who triggers this can only ever cause the fixed
// dispatcher.dispatch() call below to run (draining the notification
// outbox) -- they never get a handle to the service-role client itself, so
// this does not change the item 10 service-role isolation boundary.
export async function dispatchPendingReservationNotifications(): Promise<void> {
  try {
    const whatsAppAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!whatsAppAccessToken) return;

    const database = createSupabaseServiceRoleClient();
    const dispatcher = buildReservationNotificationDispatcher(database, whatsAppAccessToken);
    await dispatcher.dispatch("patient-reservations-worker", 5);
  } catch {
    // Swallowed deliberately -- see comment above.
  }
}
