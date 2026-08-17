-- clinical_reviews already has pharmacist/patient RLS policies, but the
-- table-level SELECT grant was never issued. Without both layers, a real
-- authenticated pharmacist cannot open the pending review through PostgREST.
grant select on public.clinical_reviews to authenticated, service_role;
