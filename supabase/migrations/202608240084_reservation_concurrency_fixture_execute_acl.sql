-- Supabase-managed default privileges grant new public-schema functions
-- directly to anon and authenticated. Restrict this mutation-capable test
-- fixture to service_role while retaining its internal role guard.
revoke all on function public.certify_reservation_concurrency_fixture(text, uuid[])
  from public;
revoke all on function public.certify_reservation_concurrency_fixture(text, uuid[])
  from anon;
revoke all on function public.certify_reservation_concurrency_fixture(text, uuid[])
  from authenticated;
grant execute on function public.certify_reservation_concurrency_fixture(text, uuid[])
  to service_role;
