import { createClient } from "@supabase/supabase-js";

import {
  getPublicEnvironment,
  getSupabaseServiceRoleEnvironment,
} from "../env";

// The one narrow exception ADR 0001's amendment (ADR 0004) documents: a
// service-role client, used only by the Conversation Runtime's WhatsApp
// webhook entry point to write conversation_messages/conversation_events
// (migration 202607290012, service-role-only by construction -- there is no
// Supabase-authenticated caller RLS could evaluate for an inbound webhook).
// The operational health probe also uses this client for read-only dependency
// checks because its public endpoint has no user session and the audited
// tables intentionally deny anonymous reads. All domain writes still go
// through createSupabaseServerClient's session-scoped, RLS-evaluated client.
export function createSupabaseServiceRoleClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnvironment();
  const { SUPABASE_SERVICE_ROLE_KEY } = getSupabaseServiceRoleEnvironment();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
