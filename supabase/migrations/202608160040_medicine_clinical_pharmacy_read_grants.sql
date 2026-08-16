-- Same gap, same fix as 202608150033_reservation_fulfillment_read_grants.sql
-- and 202608160039_identity_membership_grants.sql: medicines,
-- pharmacy_locations, and clinical_validations each already carry real
-- "to authenticated" RLS policies (medicines_read, pharmacy_locations_
-- discovery_read, clinical_validations_clinical), but none ever received
-- a table-level GRANT. With the requestDatabase() Authorization fix in
-- this same PR now letting a real cookie-based browser session reach
-- PostgREST as "authenticated" for the first time (rather than silently
-- falling back to "anon"), the browser auth E2E suite's first real
-- authenticated reads surfaced this directly:
--   - patient's mar list embeds medicine:medicines(...) -> 503
--   - pharmacist's review list selects clinical_validations directly -> 503
--   - pharmacy's inventory list embeds pharmacy:pharmacy_locations(...)
--     and medicine:medicines(...) -> the embedded-resource 42501 is
--     mapped to a misleading 403 "inventory_operation_forbidden" by
--     packages/inventory's error classifier, not a real authorization
--     decision
--   - pharmacy's reservation inbox and patient's own reservation list
--     both embed the same two relations -> 503
grant select on public.medicines to authenticated, service_role;
grant select on public.pharmacy_locations to authenticated, service_role;
grant select on public.clinical_validations to authenticated, service_role;
