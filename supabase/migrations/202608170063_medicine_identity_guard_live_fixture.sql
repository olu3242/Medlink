-- Service-role-only fixture for the reserve_inventory medicine-identity
-- guard live test (packages/runtime/src/reserve-inventory-medicine-
-- identity-live.test.ts). Seeds a MAR already at 'reviewed' (via a real
-- approved clinical_reviews row, satisfying enforce_and_audit_mar_state's
-- own check) plus two medicines and their inventory batches at the same
-- pharmacy location: one matching the MAR's requested medicine, one not.
-- The test itself calls the real match_inventory and reserve_inventory
-- RPCs as the patient -- this fixture only removes the unrelated setup
-- (prescription intake, clinical review UI) that 202608170062's guard
-- does not depend on.
create or replace function public.certify_medicine_identity_guard_fixture(
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
  medicine_id uuid := gen_random_uuid();
  other_medicine_id uuid := gen_random_uuid();
  batch_id uuid := gen_random_uuid();
  other_batch_id uuid := gen_random_uuid();
  mar_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values
    (medicine_id, 'Identity Guard Medicine ' || fixture_key,
      'identity-guard-generic-' || fixture_key, 'tablet', 'oral', '500mg', 'active'),
    (other_medicine_id, 'Identity Guard Unrelated Medicine ' || fixture_key,
      'identity-guard-unrelated-generic-' || fixture_key, 'capsule', 'oral', '250mg', 'active');

  insert into public.organizations(id, name, slug, type) values (
    organization_id, 'Identity Guard ' || fixture_key, 'identity-guard-' || fixture_key, 'pharmacy'
  );

  insert into public.user_profiles(id, display_name) values
    (patient_id, 'Identity Guard Patient')
  on conflict (id) do nothing;

  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, patient_id, 'patient');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Identity Guard Pharmacy', '1 Certification Way',
    'Lagos', 'NG', 6.5244, 3.3792
  );

  insert into public.inventory_batches(
    id, organization_id, pharmacy_location_id, medicine_id, batch_number, expires_on,
    quantity_on_hand, unit, status, created_by
  ) values
    (batch_id, organization_id, location_id, medicine_id, 'GUARD-' || fixture_key, '2099-12-31',
      50, 'tablet', 'available', patient_id),
    (other_batch_id, organization_id, location_id, other_medicine_id, 'GUARD-OTHER-' || fixture_key,
      '2099-12-31', 50, 'capsule', 'available', patient_id);

  insert into public.medication_access_requests(
    id, organization_id, patient_id, requested_medicine_id, state,
    transition_idempotency_key, created_by
  ) values (
    mar_id, organization_id, patient_id, medicine_id, 'created',
    'identity-guard-mar-created-' || fixture_key, patient_id
  );
  update public.medication_access_requests set state = 'validated',
    transition_idempotency_key = 'identity-guard-mar-validated-' || fixture_key
    where id = mar_id;
  insert into public.clinical_reviews(
    organization_id, mar_id, decision, reviewed_by, reviewed_at, idempotency_key
  ) values (
    organization_id, mar_id, 'approved', '11111111-1111-4111-8111-111111111111', now(),
    'identity-guard-review-' || fixture_key
  );
  update public.medication_access_requests set state = 'reviewed',
    transition_idempotency_key = 'identity-guard-mar-reviewed-' || fixture_key
    where id = mar_id;

  return jsonb_build_object(
    'organizationId', organization_id,
    'pharmacyLocationId', location_id,
    'medicineId', medicine_id,
    'otherMedicineId', other_medicine_id,
    'inventoryBatchId', batch_id,
    'otherInventoryBatchId', other_batch_id,
    'marId', mar_id
  );
end;
$$;

revoke all on function public.certify_medicine_identity_guard_fixture(text, uuid) from public;
grant execute on function public.certify_medicine_identity_guard_fixture(text, uuid) to service_role;

comment on function public.certify_medicine_identity_guard_fixture is
  'Test-only fixture builder for the reserve_inventory medicine-identity guard live suite: a reviewed MAR plus a matching and a mismatched inventory batch at the same pharmacy location. Not part of the application runtime; granted to service_role only.';
