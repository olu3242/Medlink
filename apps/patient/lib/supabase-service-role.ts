import { createClient } from "@supabase/supabase-js";

import { getNotificationEnvironment, getPublicEnvironment } from "./env";

// The one narrow exception ADR 0001's amendment (ADR 0004) documents,
// mirrored here for the G09 minimum slice's outbox dispatch worker: a
// service-role client, used only to claim/publish/retry/dead-letter
// runtime_outbox_events rows and to persist notifications/
// notification_delivery_attempts -- none of which an ordinary patient
// session's RLS-scoped client is authorized to touch (see the "worker-only
// through the service role" policy comments in migrations 202607270004 and
// 202607270006). No other request handler in this app may construct or
// use this client; every other write goes through the session-scoped
// client requestDatabase() (@medlink/api) builds instead.
export function createSupabaseServiceRoleClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnvironment();
  const { SUPABASE_SERVICE_ROLE_KEY } = getNotificationEnvironment();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
