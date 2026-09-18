// Auth client convergence (authorization convergence repair, item 9): this
// was an independent createServerClient(...) construction identical to
// packages/platform/src/supabase-server.ts's createPersonaSupabaseServerClient
// (and to apps/web, apps/pharmacist, apps/pharmacy's own copies of the same
// code) -- same cookies() source, same NEXT_PUBLIC_SUPABASE_* env pair, same
// cookie-set try/catch. Re-exported under this app's existing name so none
// of its call sites (magic-link request + callback code exchange) need to
// change. Ordinary domain reads/writes still go through this app's own API
// routes (lib/api.ts, lib/application.ts); this client's only job is
// establishing/refreshing the session cookie itself.
export { createPersonaSupabaseServerClient as createSupabaseServerClient } from "@medlink/platform/supabase-server";
