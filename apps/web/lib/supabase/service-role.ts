import { createClient } from "@supabase/supabase-js";

import { getPublicEnvironment, getServerEnvironment } from "../env";

// The one narrow exception ADR 0001's amendment (ADR 0004) documents: a
// service-role client, used by the Conversation Runtime's WhatsApp webhook
// entry point to write conversation_messages/conversation_events (migration
// 202607290012, service-role-only by construction -- there is no
// Supabase-authenticated caller RLS could evaluate for an inbound webhook),
// by the operational health probe for read-only dependency checks (its
// public endpoint has no user session and the audited tables intentionally
// deny anonymous reads), and by lib/patient and lib/pharmacy's
// notification-dispatch.ts to drain the best-effort WhatsApp notification
// outbox after an already-authorized reservation action commits. None of
// these give a Patient/Provider/Pharmacist/Pharmacy/Admin role a path to
// this client itself -- each caller can only trigger the one fixed
// operation its own code performs with it. All ordinary domain reads/writes
// still go through createSupabaseServerClient's session-scoped,
// RLS-evaluated client.
export function createSupabaseServiceRoleClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnvironment();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnvironment();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
