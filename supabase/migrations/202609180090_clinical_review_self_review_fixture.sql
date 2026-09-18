-- Service-role-only fixture for clinical-review-self-review-live.test.ts
-- (authorization convergence repair, item 6). Mirrors
-- certify_medication_golden_loop_fixture (202608170041) almost exactly,
-- except medication_access_requests.created_by is set to the reviewing
-- pharmacist's id at insert time instead of the patient's, producing the
-- self-review condition decide_clinical_review's guard exists to catch
-- (creator === deciding actor) directly.
--
-- This replaces an earlier version of this migration
-- (mar_creator_reassignment_fixture) that instead built a normal
-- golden-loop fixture and then reassigned the MAR's created_by via a
-- direct UPDATE afterward. That always failed: CI showed
-- "MAR ownership fields are immutable" -- enforce_and_audit_mar_state's
-- BEFORE UPDATE trigger on medication_access_requests
-- (202607270003_medication_access_core.sql) unconditionally rejects any
-- UPDATE that changes created_by, including from a service-role-only
-- fixture function. The trigger only guards UPDATE, not INSERT (its
-- ownership-immutability check is under the `tg_op = 'INSERT'` early
-- return), so setting created_by correctly at insert time sidesteps it
-- entirely rather than fighting it.
create or replace function public.certify_clinical_review_self_review_fixture(
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
    medicine_id, 'Self Review Medicine ' || fixture_key, 'self-review-generic-' || fixture_key,
    'tablet', 'oral', '500mg', 'active'
  );

  insert into public.organizations(id, name, slug, type) values (
    organization_id, 'Self Review ' || fixture_key, 'self-review-' || fixture_key, 'pharmacy'
  );

  insert into public.user_profiles(id, display_name) values
    (patient_id, 'Self Review Patient'),
    (pharmacist_id, 'Self Review Pharmacist'),
    (pharmacy_staff_id, 'Self Review Pharmacy Staff')
  on conflict (id) do nothing;

  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, patient_id, 'patient'),
    (organization_id, pharmacist_id, 'pharmacist'),
    (organization_id, pharmacy_staff_id, 'pharmacy_staff');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Self Review Pharmacy', '1 Certification Way',
    'Lagos', 'NG', 6.5244, 3.3792
  );

  insert into public.inventory_batches(
    id, organization_id, pharmacy_location_id, medicine_id, batch_number, expires_on,
    quantity_on_hand, unit, status, created_by
  ) values (
    batch_id, organization_id, location_id, medicine_id, 'SELFREVIEW-' || fixture_key, '2099-12-31',
    50, 'tablet', 'available', pharmacist_id
  );

  -- created_by is the reviewing pharmacist, not the patient -- the
  -- self-review condition under test, set once at insert rather than
  -- reassigned afterward.
  insert into public.medication_access_requests(
    id, organization_id, patient_id, requested_medicine_id, state,
    transition_idempotency_key, created_by
  ) values (
    mar_id, organization_id, patient_id, medicine_id, 'created',
    'fixture-mar-created-' || fixture_key, pharmacist_id
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
    'marId', mar_id,
    'reviewId', review_id
  );
end;
$$;

revoke all on function public.certify_clinical_review_self_review_fixture(
  text, uuid, uuid, uuid
) from public;
grant execute on function public.certify_clinical_review_self_review_fixture(
  text, uuid, uuid, uuid
) to service_role;

comment on function public.certify_clinical_review_self_review_fixture is
  'Test-only fixture for clinical-review-self-review-live.test.ts: like certify_medication_golden_loop_fixture, but sets medication_access_requests.created_by to the reviewing pharmacist at insert time (not the patient), producing the self-review condition directly. Not part of the application runtime; granted to service_role only.';
