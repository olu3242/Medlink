-- Fixes a real regression surfaced by CI's medication-golden-loop-e2e job
-- against 202608240001_marketplace_registration_validity.sql: the golden
-- loop and WhatsApp discovery fixtures create medicines with inventory but
-- never gave them a medicine_registrations row, so once
-- discover_marketplace_inventory started requiring
-- medicine_has_valid_registration, both fixtures' medicines correctly
-- became regulatorily ineligible and the E2E's expected BOTH_AVAILABLE
-- outcome (one exact + one generic_related result) turned into
-- NONE_AVAILABLE. This is the fixtures failing to model a realistic
-- registered medicine, not a defect in the new predicate -- the fix is to
-- give each fixture medicine a straightforwardly currently-valid
-- registration, matching what a real discoverable medicine would have.
-- Re-published in full (`create or replace function`, unchanged
-- otherwise) rather than editing the already-applied migration files
-- (202608170041, 202608170058), preserving migration history.
create or replace function public.certify_medication_golden_loop_fixture(
  fixture_key text,
  patient_id uuid,
  pharmacist_id uuid,
  pharmacy_staff_id uuid
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
  batch_id uuid := gen_random_uuid();
  mar_id uuid := gen_random_uuid();
  review_id uuid;
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values (
    medicine_id, 'Golden Loop Medicine ' || fixture_key, 'golden-loop-generic-' || fixture_key,
    'tablet', 'oral', '500mg', 'active'
  );
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    medicine_id, 'NG', 'NAFDAC', 'GOLDEN-LOOP-' || fixture_key,
    current_date - interval '1 year', current_date + interval '1 year'
  );

  insert into public.organizations(id, name, slug, type) values (
    organization_id, 'Golden Loop ' || fixture_key, 'golden-loop-' || fixture_key, 'pharmacy'
  );

  insert into public.user_profiles(id, display_name) values
    (patient_id, 'Golden Loop Patient'),
    (pharmacist_id, 'Golden Loop Pharmacist'),
    (pharmacy_staff_id, 'Golden Loop Pharmacy Staff')
  on conflict (id) do nothing;

  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, patient_id, 'patient'),
    (organization_id, pharmacist_id, 'pharmacist'),
    (organization_id, pharmacy_staff_id, 'pharmacy_staff');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Golden Loop Pharmacy', '1 Certification Way',
    'Lagos', 'NG', 6.5244, 3.3792
  );

  insert into public.inventory_batches(
    id, organization_id, pharmacy_location_id, medicine_id, batch_number, expires_on,
    quantity_on_hand, unit, status, created_by
  ) values (
    batch_id, organization_id, location_id, medicine_id, 'GOLDEN-' || fixture_key, '2099-12-31',
    50, 'tablet', 'available', pharmacist_id
  );

  insert into public.medication_access_requests(
    id, organization_id, patient_id, requested_medicine_id, state,
    transition_idempotency_key, created_by
  ) values (
    mar_id, organization_id, patient_id, medicine_id, 'created',
    'fixture-mar-created-' || fixture_key, patient_id
  );
  update public.medication_access_requests set state = 'validated',
    transition_idempotency_key = 'fixture-mar-validated-' || fixture_key
    where id = mar_id;
  insert into public.clinical_reviews(
    organization_id, mar_id, decision, idempotency_key
  ) values (
    organization_id, mar_id, 'pending', 'fixture-review-' || fixture_key
  ) returning id into review_id;

  return jsonb_build_object(
    'organizationId', organization_id,
    'pharmacyLocationId', location_id,
    'medicineId', medicine_id,
    'medicineName', 'Golden Loop Medicine ' || fixture_key,
    'inventoryBatchId', batch_id,
    'marId', mar_id,
    'reviewId', review_id
  );
end;
$$;

revoke all on function public.certify_medication_golden_loop_fixture(
  text, uuid, uuid, uuid
) from public;
grant execute on function public.certify_medication_golden_loop_fixture(
  text, uuid, uuid, uuid
) to service_role;

comment on function public.certify_medication_golden_loop_fixture is
  'Test-only fixture builder for the browser medication-access golden-loop E2E suite. Not part of the application runtime; granted to service_role only. Its medicine now carries a currently-valid medicine_registrations row (202608240004) so it remains discoverable under discover_marketplace_inventory''s registration-validity gate.';

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
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    generic_medicine_id, 'NG', 'NAFDAC', 'GOLDEN-GENERIC-' || fixture_key,
    current_date - interval '1 year', current_date + interval '1 year'
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
  'Test-only exact-plus-generic geo discovery fixture; service_role only. Its generic medicine now carries a currently-valid medicine_registrations row (202608240004) so it remains discoverable under discover_marketplace_inventory''s registration-validity gate.';
