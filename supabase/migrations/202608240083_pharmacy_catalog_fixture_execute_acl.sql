-- Supabase-managed default privileges grant new public-schema functions
-- directly to anon and authenticated. The original fixture migration revoked
-- PUBLIC, but those explicit role grants remained. Keep this test-only RPC
-- executable solely by service_role while preserving its internal role guard.
revoke all on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid)
  from public;
revoke all on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid)
  from anon;
revoke all on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid)
  from authenticated;
grant execute on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid)
  to service_role;
