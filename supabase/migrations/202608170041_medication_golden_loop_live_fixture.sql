-- Service-role-only fixture for the browser medication-access golden-loop
-- E2E suite (packages/e2e). Same posture and pattern as
-- certify_reservation_fulfillment_fixture: composes existing table
-- invariants directly (not the create_mar/decide_clinical_review RPCs,
-- which each authenticate as a single caller) so that patient- and
-- pharmacist-attributed rows can be produced in one service-role
-- transaction, while still walking the MAR state machine through its
-- initial validation rather than bypassing its guarding trigger.
--
-- This fixture stops at 'validated' with a pending clinical review. The
-- pharmacist browser must approve it, and the patient browser must match
-- and reserve inventory. It creates NO reservation and NO inventory lock.
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
  'Test-only fixture builder for the browser medication-access golden-loop E2E suite. Not part of the application runtime; granted to service_role only.';
