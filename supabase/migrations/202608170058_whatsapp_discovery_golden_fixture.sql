-- Extends the existing service-role-only golden-loop fixture with one nearby
-- canonical medicine that shares the requested medicine's governed generic
-- identity, strength and dosage form. It creates no substitution decision:
-- the related option remains pharmacist-gated in the discovery contract.
create or replace function public.certify_whatsapp_discovery_golden_fixture(
  target_organization_id uuid,
  target_requested_medicine_id uuid,
  target_created_by uuid,
  fixture_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested public.medicines%rowtype;
  generic_medicine_id uuid := gen_random_uuid();
  generic_location_id uuid := gen_random_uuid();
  generic_inventory_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  select medicine.* into requested
  from public.medicines medicine
  where medicine.id = target_requested_medicine_id
    and medicine.status = 'active'
    and medicine.deleted_at is null;
  if not found or not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_created_by
      and membership.deleted_at is null
  ) then
    raise exception 'invalid discovery fixture context' using errcode = '42501';
  end if;

  update public.inventory_batches
  set unit_price_minor = 250000, unit_price_currency_code = 'NGN'
  where organization_id = target_organization_id
    and medicine_id = target_requested_medicine_id;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display,
    manufacturer_name, status
  ) values (
    generic_medicine_id, 'Golden Generic Option ' || fixture_key,
    requested.generic_name, requested.dosage_form, requested.route,
    requested.strength_display, 'MedLink Golden Generic Manufacturer', 'active'
  );

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code,
    latitude, longitude
  ) values (
    generic_location_id, target_organization_id, 'Golden Generic Pharmacy',
    '2 Certification Way', 'Lagos', 'NG', 6.5344, 3.3892
  );

  insert into public.inventory_batches(
    id, organization_id, pharmacy_location_id, medicine_id, batch_number,
    expires_on, quantity_on_hand, unit, status, created_by
  ) values (
    generic_inventory_id, target_organization_id, generic_location_id,
    generic_medicine_id, 'GENERIC-' || fixture_key, '2099-11-30', 20,
    'tablet', 'available', target_created_by
  );

  return jsonb_build_object(
    'genericMedicineId', generic_medicine_id,
    'genericPharmacyLocationId', generic_location_id,
    'genericInventoryBatchId', generic_inventory_id
  );
end;
$$;

revoke all on function public.certify_whatsapp_discovery_golden_fixture(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.certify_whatsapp_discovery_golden_fixture(
  uuid, uuid, uuid, text
) to service_role;

comment on function public.certify_whatsapp_discovery_golden_fixture is
  'Test-only exact-plus-generic geo discovery fixture; service_role only.';
