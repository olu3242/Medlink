-- reservations, inventory_locks, and fulfillment_transitions each already
-- have correctly scoped RLS policies (reservations_read,
-- inventory_locks_member_read, and fulfillment_transitions' own read
-- policy), but RLS only governs which *rows* a query sees -- Postgres
-- still requires a table-level GRANT before PostgREST can run any query
-- against the table at all, and none was ever added for these three. That
-- makes the existing policies unreachable dead code today, and is exactly
-- why direct reads against these tables came back "42501: permission
-- denied" in CI's live-database job (both for a service_role client and
-- for a real authenticated actor session) even though the RPC functions
-- that also touch these tables succeed -- a SECURITY DEFINER function runs
-- with its owner's privileges, not the caller's, so it never needed this
-- grant. This almost certainly also affects the already-shipped
-- apps/pharmacy F1 reservation inbox route (listReservations() in
-- apps/pharmacy/lib/reservations.ts selects from "reservations" directly),
-- not only the new live fulfillment tests. Extends the same
-- grant-to-anon-for-a-curated-list pattern already established by
-- 202608120023_live_rls_schema_visibility.sql, scoped to authenticated
-- (and service_role, matching how the hosted Supabase platform's own
-- default project bootstrap grants service_role broad table access --
-- something the local CLI's minimal roles.sql does not replicate).
grant select on public.reservations to authenticated, service_role;
grant select on public.inventory_locks to authenticated, service_role;
grant select on public.fulfillment_transitions to authenticated, service_role;

-- Same gap, same fix: medication_access_requests and inventory_batches
-- already have real RLS policies scoped "to authenticated" that are
-- equally unreachable without a table-level grant.
grant select on public.medication_access_requests to authenticated, service_role;
grant select on public.inventory_batches to authenticated, service_role;
