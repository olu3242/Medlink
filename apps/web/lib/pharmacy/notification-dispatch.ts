import { createClient } from "@supabase/supabase-js";
import { buildReservationNotificationDispatcher } from "@medlink/notifications";

// G09 reconciliation: same best-effort contract as
// apps/patient/lib/notification-dispatch.ts, piggybacked on the pharmacy
// side of the lifecycle (confirm/decline, ready, collect) instead of only
// reservation creation. A pharmacy action has already committed by the
// time this runs -- a WhatsApp outage or notification-store failure here
// must never turn into a failed decision/ready/collect response.
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
    await dispatcher.dispatch("pharmacy-reservations-worker", 5);
  } catch {
    // Swallowed deliberately -- see comment above.
  }
}
