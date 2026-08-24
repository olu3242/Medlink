-- Service-role-only fixture for the reservation concurrency / no-oversell
-- live suite (packages/runtime/src/reservation-concurrency-live.test.ts).
-- reserve_inventory itself is NOT modified by this migration: the
-- atomicity guarantee it relies on already exists, unchanged, in
-- 202607270003's sync_inventory_lock_quantity trigger (a single
-- conditional UPDATE on inventory_batches with a WHERE-clause guard,
-- `if not found then raise exception` -- Postgres serializes concurrent
-- UPDATEs to the same row, so the guard is re-evaluated under lock, not
-- racy) and 202608160037's release_expired_inventory_holds (`for update
-- of lock skip locked`, safe for concurrent workers). This fixture only
-- seeds the actors and MARs the test needs to exercise that existing
-- mechanism; it seeds no inventory_batches rows itself, since each test
-- scenario needs a batch with a different starting quantity_on_hand --
-- the test creates those directly via the service-role client.
--
-- patient_ids must contain exactly 9 patients, in this fixed order:
--   [0] race A            -- stock=1, two concurrent quantity-1 requests
--   [1] race B             (one must win, one must lose, stock -> 0)
--   [2] two-units A        -- stock=2, two concurrent quantity-1 requests
--   [3] two-units B         (both must win, stock -> 0)
--   [4] insufficient stock -- stock=1, one request for quantity=2 (reject)
--   [5] sequential replay  -- same idempotency key, called twice in series
--   [6] concurrent replay  -- same idempotency key, called twice at once
--   [7] expiry/release     -- reserved then force-expired, capacity restored
--   [8] cross-tenant       -- member of the *other* organization only
create or replace function public.certify_reservation_concurrency_fixture(
  fixture_key text,
  patient_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_id uuid := gen_random_uuid();
  other_organization_id uuid := gen_random_uuid();
  location_id uuid := gen_random_uuid();
  other_location_id uuid := gen_random_uuid();
  medicine_id uuid := gen_random_uuid();
  mar_ids uuid[] := array[]::uuid[];
  idx integer;
  mar_id uuid;
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;
  if patient_ids is null or array_length(patient_ids, 1) <> 9 then
    raise exception 'certify_reservation_concurrency_fixture requires exactly 9 patient_ids';
  end if;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values (
    medicine_id, 'Concurrency Fixture Medicine ' || fixture_key,
    'concurrency-fixture-generic-' || fixture_key, 'tablet', 'oral', '500mg', 'active'
  );

  insert into public.organizations(id, name, slug, type) values
    (organization_id, 'Concurrency Fixture ' || fixture_key, 'concurrency-fixture-' || fixture_key, 'pharmacy'),
    (other_organization_id, 'Concurrency Fixture Other ' || fixture_key, 'concurrency-fixture-other-' || fixture_key, 'pharmacy');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values
    (location_id, organization_id, 'Concurrency Fixture Pharmacy', '1 Certification Way',
      'Lagos', 'NG', 6.5244, 3.3792),
    (other_location_id, other_organization_id, 'Concurrency Fixture Other Pharmacy', '2 Certification Way',
      'Lagos', 'NG', 6.5300, 3.3800);

  for idx in 1..9 loop
    insert into public.user_profiles(id, display_name) values
      (patient_ids[idx], 'Concurrency Fixture Patient ' || idx)
    on conflict (id) do nothing;
  end loop;

  -- patients [0..7] (1-indexed 1..8) belong to the primary organization;
  -- patient [8] (1-indexed 9) belongs only to the other organization, for
  -- the cross-tenant rejection case.
  insert into public.organization_memberships(organization_id, user_id, role)
  select organization_id, patient_ids[idx], 'patient'
  from generate_series(1, 8) as idx;
  insert into public.organization_memberships(organization_id, user_id, role) values
    (other_organization_id, patient_ids[9], 'patient');

  for idx in 1..8 loop
    mar_id := gen_random_uuid();
    insert into public.medication_access_requests(
      id, organization_id, patient_id, requested_medicine_id, state,
      transition_idempotency_key, created_by
    ) values (
      mar_id, organization_id, patient_ids[idx], medicine_id, 'created',
      'concurrency-fixture-mar-created-' || fixture_key || '-' || idx, patient_ids[idx]
    );
    update public.medication_access_requests set state = 'validated',
      transition_idempotency_key = 'concurrency-fixture-mar-validated-' || fixture_key || '-' || idx
      where id = mar_id;
    insert into public.clinical_reviews(
      organization_id, mar_id, decision, reviewed_by, reviewed_at, idempotency_key
    ) values (
      organization_id, mar_id, 'approved', '11111111-1111-4111-8111-111111111111', now(),
      'concurrency-fixture-review-' || fixture_key || '-' || idx
    );
    update public.medication_access_requests set state = 'reviewed',
      transition_idempotency_key = 'concurrency-fixture-mar-reviewed-' || fixture_key || '-' || idx
      where id = mar_id;
    mar_ids := array_append(mar_ids, mar_id);
  end loop;

  return jsonb_build_object(
    'organizationId', organization_id,
    'otherOrganizationId', other_organization_id,
    'pharmacyLocationId', location_id,
    'otherPharmacyLocationId', other_location_id,
    'medicineId', medicine_id,
    'marIds', to_jsonb(mar_ids)
  );
end;
$$;

revoke all on function public.certify_reservation_concurrency_fixture(text, uuid[]) from public;
grant execute on function public.certify_reservation_concurrency_fixture(text, uuid[]) to service_role;

comment on function public.certify_reservation_concurrency_fixture is
  'Test-only fixture builder for the reservation concurrency / no-oversell live suite: two organizations, one canonical medicine, and 8 reviewed MARs in the primary organization plus one patient who is a member only of the other organization. Seeds no inventory_batches -- each scenario in the test creates its own batch at the quantity it needs. Not part of the application runtime; granted to service_role only.';
