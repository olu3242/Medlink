-- Database-backed proof that one published canonical medicine crosses the
-- medication-access loop without leaking regulatory source identity.
create or replace function public.certify_medication_access_golden_path(
  patient_id uuid, pharmacist_id uuid, inventory_actor_id uuid, fixture_key text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  lineage jsonb;
  inventory_row record;
  available_row record;
  wrong_organization_id uuid := gen_random_uuid();
  available_found boolean;
  out_of_stock_excluded boolean;
  inactive_excluded boolean;
  cross_tenant_denied boolean := false;
  off_list_excluded boolean;
  product_9452_excluded boolean;
  manufacturer_1161_safe boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service-role certification context required' using errcode='42501';
  end if;

  lineage := public.certify_merdp_wave1_golden_lineage(
    patient_id, pharmacist_id, inventory_actor_id, fixture_key
  );
  select * into strict inventory_row from public.inventory_batches
  where id=(lineage->>'inventoryReferenceId')::uuid;

  perform set_config('request.jwt.claim.sub',inventory_actor_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select * into strict available_row from public.search_inventory_availability(
    inventory_row.organization_id, inventory_row.medicine_id,
    inventory_row.pharmacy_location_id, 1
  );
  available_found := available_row.inventory_id=inventory_row.id
    and available_row.medicine_id=(lineage->>'canonicalMedicineId')::uuid;
  select not exists(select 1 from public.search_inventory_availability(
    inventory_row.organization_id, inventory_row.medicine_id,
    inventory_row.pharmacy_location_id, inventory_row.available_quantity+1
  )) into out_of_stock_excluded;

  update public.pharmacy_locations set is_active=false
  where id=inventory_row.pharmacy_location_id;
  select not exists(select 1 from public.search_inventory_availability(
    inventory_row.organization_id, inventory_row.medicine_id,
    inventory_row.pharmacy_location_id, 1
  )) into inactive_excluded;
  update public.pharmacy_locations set is_active=true
  where id=inventory_row.pharmacy_location_id;

  insert into public.organizations(id,name,slug,type) values(
    wrong_organization_id,'Golden Path Wrong Tenant',
    'golden-path-wrong-'||fixture_key,'pharmacy'
  );
  begin
    perform public.search_inventory_availability(
      wrong_organization_id, inventory_row.medicine_id, null, 1
    );
  exception when others then cross_tenant_denied := sqlstate in ('22023','42501');
  end;

  select not exists(
    select 1 from public.merdp_publications p
    join public.merdp_manufacturer_product_relationships r
      on r.canonical_product_id=p.canonical_product_id
    where r.current_listing_membership=false
  ) into off_list_excluded;
  select not exists(
    select 1 from public.merdp_publications p
    join public.merdp_source_mappings m on m.canonical_product_id=p.canonical_product_id
    join public.etl_source_records r on r.id=m.source_record_id
    where r.source_record_id='9452'
  ) into product_9452_excluded;
  select not exists(
    select 1 from public.merdp_manufacturer_identities
    where source_manufacturer_id='1161' and canonical_organization_id is not null
  ) into manufacturer_1161_safe;

  if not available_found or not out_of_stock_excluded or not inactive_excluded
     or not cross_tenant_denied or not off_list_excluded
     or not product_9452_excluded or not manufacturer_1161_safe then
    raise exception 'medication access certification assertion failed';
  end if;

  return lineage || jsonb_build_object(
    'inventoryOrganizationId',inventory_row.organization_id,
    'pharmacyLocationId',inventory_row.pharmacy_location_id,
    'availableQuantity',available_row.available_quantity,
    'availabilityState',available_row.availability_state,
    'available',available_found,'outOfStockExcluded',out_of_stock_excluded,
    'inactiveInventoryExcluded',inactive_excluded,
    'crossTenantInventoryDenied',cross_tenant_denied,
    'offListRuntimeExcluded',off_list_excluded,
    'product9452Excluded',product_9452_excluded,
    'manufacturer1161Safe',manufacturer_1161_safe,
    'reservation','MVP_GAP_UI_API_CONTRACT'
  );
end;
$$;
revoke all on function public.certify_medication_access_golden_path(uuid,uuid,uuid,text) from public;
grant execute on function public.certify_medication_access_golden_path(uuid,uuid,uuid,text) to service_role;
