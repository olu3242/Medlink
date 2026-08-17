-- The canonical medicine repository embeds these relations through
-- PostgREST after search_medicines returns IDs. Their existing authenticated
-- RLS policies restrict reads to active/non-deleted catalog projections.
grant select on public.therapeutic_classes to authenticated, service_role;
grant select on public.active_ingredients to authenticated, service_role;
grant select on public.medicine_ingredients to authenticated, service_role;
grant select on public.medicine_aliases to authenticated, service_role;
grant select on public.medicine_registrations to authenticated, service_role;
