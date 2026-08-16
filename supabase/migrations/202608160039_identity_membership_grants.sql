-- organizations, user_profiles, and organization_memberships have carried
-- real RLS policies since 202607270001_platform_core.sql (organizations_
-- select_member, profiles_select_self, profiles_update_self, memberships_
-- select_same_tenant, memberships_manage_admin), but -- matching the exact
-- gap already found and fixed for reservations/inventory_locks/
-- fulfillment_transitions/medication_access_requests/inventory_batches in
-- 202608150033_reservation_fulfillment_read_grants.sql -- RLS only governs
-- which *rows* a query sees; Postgres still requires a table-level GRANT
-- before PostgREST (or any other client) can run a query against the
-- table at all. No path ever exercised these three tables directly until
-- now: packages/api's authenticate() resolves a signed-in user's tenant
-- context by selecting from organization_memberships as that user's own
-- authenticated session (not service_role), and the new browser auth E2E
-- harness provisions its deterministic fixture by inserting into all
-- three tables through the service role. Both failed with 42501 in CI
-- before this grant existed -- the local CLI's minimal roles.sql does not
-- replicate the hosted platform's broad service_role table access, same
-- as the precedent migration's comment documents.
grant insert on public.organizations to service_role;
grant insert on public.user_profiles to service_role;
grant insert on public.organization_memberships to service_role;
grant select on public.organization_memberships to authenticated, service_role;
