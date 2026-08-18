-- Browser-certification control for rendering each canonical discovery
-- outcome. This is service-role-only, tenant-scoped, and cannot create or
-- mutate production transaction truth through an authenticated persona.
create or replace function public.certify_frontend_discovery_outcome_fixture(
  target_organization_id uuid,
  target_exact_inventory_batch_id uuid,
  target_generic_inventory_batch_id uuid,
  target_outcome text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
    or target_outcome not in (
      'EXACT_BRAND_AVAILABLE', 'GENERIC_AVAILABLE',
      'BOTH_AVAILABLE', 'NONE_AVAILABLE'
    ) then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.inventory_batches
    where id = target_exact_inventory_batch_id
      and organization_id = target_organization_id
      and deleted_at is null
  ) or not exists (
    select 1 from public.inventory_batches
    where id = target_generic_inventory_batch_id
      and organization_id = target_organization_id
      and deleted_at is null
  ) then
    raise exception 'invalid discovery certification inventory' using errcode = '42501';
  end if;

  update public.inventory_batches
  set status = case
    when id = target_exact_inventory_batch_id
      and target_outcome in ('EXACT_BRAND_AVAILABLE', 'BOTH_AVAILABLE') then 'available'::public.inventory_batch_status
    when id = target_generic_inventory_batch_id
      and target_outcome in ('GENERIC_AVAILABLE', 'BOTH_AVAILABLE') then 'available'::public.inventory_batch_status
    else 'depleted'::public.inventory_batch_status
  end
  where organization_id = target_organization_id
    and id in (target_exact_inventory_batch_id, target_generic_inventory_batch_id);

  return target_outcome;
end;
$$;

revoke all on function public.certify_frontend_discovery_outcome_fixture(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.certify_frontend_discovery_outcome_fixture(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.certify_frontend_discovery_outcome_fixture is
  'Service-role-only test fixture control for four-outcome browser certification.';
