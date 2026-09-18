-- Service-role-only live-certification fixture for
-- 202608240001_marketplace_registration_validity.sql. Builds one patient
-- organization + one pharmacy location, then one independently-inventoried
-- medicine per registration scenario (A-E, each queried as its own EXACT
-- target so the relationship branch is not a confound) plus a matched
-- requested/generic-related pair for scenario F. All inventory sits at the
-- same pharmacy location/coordinates so every discover_marketplace_inventory
-- call in the live test can use radius=1 and the exact same lat/lng,
-- keeping the only variable under test the registration evidence itself.
create or replace function public.certify_marketplace_registration_validity_fixture(
  fixture_key text,
  patient_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid := gen_random_uuid();
  location_id uuid := gen_random_uuid();
  valid_medicine_id uuid := gen_random_uuid();
  expired_medicine_id uuid := gen_random_uuid();
  missing_medicine_id uuid := gen_random_uuid();
  open_ended_medicine_id uuid := gen_random_uuid();
  multiple_medicine_id uuid := gen_random_uuid();
  generic_requested_medicine_id uuid := gen_random_uuid();
  generic_expired_medicine_id uuid := gen_random_uuid();
  batch_ids uuid[] := array[]::uuid[];
  medicine record;
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  insert into public.organizations(id, name, slug, type) values
    (organization_id, 'Registration Validity Fixture ' || fixture_key,
     'registration-validity-fixture-' || fixture_key, 'pharmacy');

  insert into public.user_profiles(id, display_name) values
    (patient_id, 'Registration Validity Fixture Patient')
  on conflict (id) do nothing;
  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, patient_id, 'patient');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Registration Validity Fixture Pharmacy',
    '1 Certification Way', 'Lagos', 'NG', 6.5244, 3.3792
  );

  for medicine in
    select * from (values
      ('valid', valid_medicine_id, 'Registration Fixture Valid', true),
      ('expired', expired_medicine_id, 'Registration Fixture Expired', true),
      ('missing', missing_medicine_id, 'Registration Fixture Missing', true),
      ('open_ended', open_ended_medicine_id, 'Registration Fixture Open Ended', true),
      ('multiple', multiple_medicine_id, 'Registration Fixture Multiple', true),
      -- generic_requested carries NO inventory of its own -- the exact
      -- branch of its own discover_marketplace_inventory call must always
      -- be empty, so any surfaced result is unambiguously the generic
      -- branch.
      ('generic_requested', generic_requested_medicine_id, 'Registration Fixture Generic Requested', false),
      ('generic_expired', generic_expired_medicine_id, 'Registration Fixture Generic Equivalent', true)
    ) as scenarios(kind, id, brand_name, needs_inventory)
  loop
    insert into public.medicines(
      id, brand_name, generic_name, dosage_form, route, strength_display, status
    ) values (
      medicine.id, medicine.brand_name,
      case when medicine.kind in ('generic_requested', 'generic_expired')
        then 'registration-fixture-shared-generic-' || fixture_key
        else 'registration-fixture-generic-' || medicine.kind || '-' || fixture_key end,
      'tablet', 'oral', '500 mg', 'active'
    );
    if medicine.needs_inventory then
      insert into public.inventory_batches(
        id, organization_id, pharmacy_location_id, medicine_id, batch_number,
        expires_on, quantity_on_hand, unit, status, created_by
      ) values (
        gen_random_uuid(), organization_id, location_id, medicine.id,
        'REGFIX-' || medicine.kind || '-' || fixture_key, '2099-11-30', 10,
        'tablet', 'available', patient_id
      );
    end if;
  end loop;

  -- A: currently valid registration.
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    valid_medicine_id, 'NG', 'NAFDAC', 'REGFIX-VALID-' || fixture_key,
    current_date - interval '1 year', current_date + interval '1 year'
  );
  -- B: expired registration.
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    expired_medicine_id, 'NG', 'NAFDAC', 'REGFIX-EXPIRED-' || fixture_key,
    current_date - interval '2 years', current_date - interval '1 day'
  );
  -- C: no registration row at all (missing_medicine_id gets none).
  -- D: open-ended valid_until.
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    open_ended_medicine_id, 'NG', 'NAFDAC', 'REGFIX-OPENENDED-' || fixture_key,
    current_date - interval '1 year', null
  );
  -- E: multiple registrations, one expired, one currently valid.
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    multiple_medicine_id, 'NG', 'NAFDAC', 'REGFIX-MULTI-OLD-' || fixture_key,
    current_date - interval '3 years', current_date - interval '2 years'
  ), (
    multiple_medicine_id, 'NG', 'NAFDAC', 'REGFIX-MULTI-CURRENT-' || fixture_key,
    current_date - interval '1 year', current_date + interval '1 year'
  );
  -- F: generic_requested is itself validly registered but carries no
  -- inventory of its own (exact branch always empty); generic_expired
  -- shares its generic identity/strength/form but has an expired
  -- registration, so it must never surface as a generic_related result.
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number, valid_from, valid_until
  ) values (
    generic_requested_medicine_id, 'NG', 'NAFDAC', 'REGFIX-GENREQ-' || fixture_key,
    current_date - interval '1 year', current_date + interval '1 year'
  ), (
    generic_expired_medicine_id, 'NG', 'NAFDAC', 'REGFIX-GENEXP-' || fixture_key,
    current_date - interval '2 years', current_date - interval '1 day'
  );

  return jsonb_build_object(
    'organizationId', organization_id,
    'pharmacyLocationId', location_id,
    'latitude', 6.5244, 'longitude', 3.3792,
    'validMedicineId', valid_medicine_id,
    'expiredMedicineId', expired_medicine_id,
    'missingMedicineId', missing_medicine_id,
    'openEndedMedicineId', open_ended_medicine_id,
    'multipleMedicineId', multiple_medicine_id,
    'genericRequestedMedicineId', generic_requested_medicine_id,
    'genericExpiredMedicineId', generic_expired_medicine_id
  );
end;
$$;

revoke all on function public.certify_marketplace_registration_validity_fixture(text, uuid)
from public, anon, authenticated;
grant execute on function public.certify_marketplace_registration_validity_fixture(text, uuid)
to service_role;

comment on function public.certify_marketplace_registration_validity_fixture is
  'Test-only fixture for the marketplace registration-validity live suite: one organization/pharmacy location, and one independently-inventoried medicine per registration scenario (valid, expired, missing, open-ended, multiple-with-one-valid), plus a matched requested/generic-equivalent pair whose equivalent carries an expired registration. Not part of the application runtime; granted to service_role only.';
