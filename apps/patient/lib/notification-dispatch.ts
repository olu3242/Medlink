import { createClient } from "@supabase/supabase-js";
import { buildReservationNotificationDispatcher } from "@medlink/notifications";

// G09 minimum slice: best-effort only. A patient's reservation has already
// committed by the time this runs -- a WhatsApp outage, missing
// credential, or notification-store failure here must never turn into a
// failed reservation response. The event this leaves unprocessed simply
// stays pending/retrying in runtime_outbox_events for the next matching
// request to pick up (see buildReservationNotificationDispatcher's own
// comment on why there is no scheduler in this environment).
export async function dispatchPendingReservationNotifications(): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const whatsAppAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!supabaseUrl || !serviceRoleKey || !whatsAppAccessToken) return;

    const database = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const dispatcher = buildReservationNotificationDispatcher(database, whatsAppAccessToken);
    await dispatcher.dispatch("patient-reservations-worker", 5);
  } catch {
    // Swallowed deliberately -- see comment above.
  }
}
