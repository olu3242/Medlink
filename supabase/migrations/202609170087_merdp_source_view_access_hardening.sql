-- The MERDP latest-source-record views were created without an explicit
-- security_invoker setting or access grants, so they inherited Supabase's
-- default public-schema privileges (full CRUD to anon/authenticated) on top
-- of the underlying etl_source_records/etl_sources/etl_snapshots tables,
-- which are otherwise RLS-enabled with no policies (service_role only).
-- No application code references these views; only the internal MERDP
-- convergence routines use them. Lock them down to match the base tables.
alter view public.merdp_latest_product_source_records set (security_invoker = true);
alter view public.merdp_latest_manufacturer_source_records set (security_invoker = true);

revoke all on public.merdp_latest_product_source_records from public, anon, authenticated;
revoke all on public.merdp_latest_manufacturer_source_records from public, anon, authenticated;
