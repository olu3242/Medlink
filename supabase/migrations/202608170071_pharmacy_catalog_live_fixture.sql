-- Service-role-only fixture for the pharmacy catalog SKU mapping live
-- suite (packages/runtime/src/pharmacy-catalog-sku-mapping-live.test.ts).
-- Seeds an organization, one pharmacy location, and two active canonical
-- medicines (so the test can exercise remapping a SKU from one medicine
-- to another, proving supersession). Does not seed any catalog item or
-- mapping row -- the test drives create_pharmacy_catalog_item,
-- propose_pharmacy_catalog_mapping, and decide_pharmacy_catalog_mapping
-- itself as the real actors, which is what this suite certifies.
create or replace function public.certify_pharmacy_catalog_fixture(
  fixture_key text,
  pharmacist_id uuid,
  staff_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid := gen_random_uuid();
  location_id uuid := gen_random_uuid();
  medicine_id uuid := gen_random_uuid();
  other_medicine_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values
    (medicine_id, 'Catalog Fixture Medicine ' || fixture_key,
      'catalog-fixture-generic-' || fixture_key, 'tablet', 'oral', '500mg', 'active'),
    (other_medicine_id, 'Catalog Fixture Remap Medicine ' || fixture_key,
      'catalog-fixture-remap-generic-' || fixture_key, 'capsule', 'oral', '250mg', 'active');

  insert into public.organizations(id, name, slug, type) values (
    organization_id, 'Catalog Fixture ' || fixture_key, 'catalog-fixture-' || fixture_key, 'pharmacy'
  );

  insert into public.user_profiles(id, display_name) values
    (pharmacist_id, 'Catalog Fixture Pharmacist'),
    (staff_id, 'Catalog Fixture Staff')
  on conflict (id) do nothing;

  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, pharmacist_id, 'pharmacist'),
    (organization_id, staff_id, 'pharmacy_staff');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Catalog Fixture Pharmacy', '1 Certification Way',
    'Lagos', 'NG', 6.5244, 3.3792
  );

  return jsonb_build_object(
    'organizationId', organization_id,
    'pharmacyLocationId', location_id,
    'medicineId', medicine_id,
    'otherMedicineId', other_medicine_id
  );
end;
$$;

revoke all on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid) from public;
grant execute on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid) to service_role;

comment on function public.certify_pharmacy_catalog_fixture is
  'Test-only fixture builder for the pharmacy catalog SKU mapping live suite: an org, a location, a pharmacist, a pharmacy_staff member, and two active canonical medicines. Not part of the application runtime; granted to service_role only.';
