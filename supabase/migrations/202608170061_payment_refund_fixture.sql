-- Service-role-only fixture for the payment-refund E2E suite
-- (packages/e2e/tests/payment-refund.spec.ts). Same posture as
-- certify_medication_golden_loop_fixture: composes existing table
-- invariants directly rather than walking the full MAR/pharmacist/browser
-- pipeline, because that pipeline is not what this suite certifies --
-- it certifies 202608170060's refund-on-exit trigger and
-- apply_refund_provider_event, which only care about a reservation that
-- is already 'confirmed' with a priced, active inventory lock.
--
-- The inventory lock is deliberately seeded already past its own
-- expires_at (while the reservation's expires_at stays in the future, so
-- create_payment_attempt's own eligibility check still passes) so the
-- test can call the real release_expired_inventory_holds worker RPC and
-- get a deterministic, immediate expiry instead of waiting on wall-clock
-- time.
create or replace function public.certify_payment_refund_fixture(
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
  batch_id uuid := gen_random_uuid();
  mar_id uuid := gen_random_uuid();
  reservation_id uuid := gen_random_uuid();
  lock_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values (
    medicine_id, 'Refund Fixture Medicine ' || fixture_key, 'refund-fixture-generic-' || fixture_key,
    'tablet', 'oral', '500mg', 'active'
  );

  insert into public.organizations(id, name, slug, type) values (
    organization_id, 'Refund Fixture ' || fixture_key, 'refund-fixture-' || fixture_key, 'pharmacy'
  );

  insert into public.user_profiles(id, display_name) values
    (patient_id, 'Refund Fixture Patient')
  on conflict (id) do nothing;

  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, patient_id, 'patient');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Refund Fixture Pharmacy', '1 Certification Way',
    'Lagos', 'NG', 6.5244, 3.3792
  );

  insert into public.inventory_batches(
    id, organization_id, pharmacy_location_id, medicine_id, batch_number, expires_on,
    quantity_on_hand, quantity_reserved, unit, unit_price_minor, unit_price_currency_code,
    status, created_by
  ) values (
    batch_id, organization_id, location_id, medicine_id, 'REFUND-' || fixture_key, '2099-12-31',
    50, 1, 'tablet', 250000, 'NGN', 'available', patient_id
  );

  -- Left at its required 'created' start state (enforce_and_audit_mar_state
  -- rejects any other state on insert) -- the reservation's FK only needs a
  -- matching MAR row to exist, and neither create_payment_attempt nor the
  -- refund-on-exit trigger this fixture exists to certify ever inspect MAR
  -- state, so walking the full created->validated->...->reserved state
  -- machine here would only test machinery this suite isn't about.
  insert into public.medication_access_requests(
    id, organization_id, patient_id, requested_medicine_id, state,
    transition_idempotency_key, created_by
  ) values (
    mar_id, organization_id, patient_id, medicine_id, 'created',
    'refund-fixture-mar-' || fixture_key, patient_id
  );

  insert into public.reservations(
    id, organization_id, mar_id, patient_id, pharmacy_location_id, status,
    payment_required, idempotency_key, expires_at, confirmed_at, created_by
  ) values (
    reservation_id, organization_id, mar_id, patient_id, location_id, 'confirmed',
    true, 'refund-fixture-reservation-' || fixture_key, now() + interval '1 day', now(), patient_id
  );

  insert into public.inventory_locks(
    id, organization_id, reservation_id, inventory_batch_id, quantity,
    status, idempotency_key, created_at, expires_at
  ) values (
    lock_id, organization_id, reservation_id, batch_id, 1,
    'active', 'refund-fixture-lock-' || fixture_key, now() - interval '2 hours', now() - interval '1 hour'
  );

  return jsonb_build_object(
    'organizationId', organization_id,
    'pharmacyLocationId', location_id,
    'medicineId', medicine_id,
    'inventoryBatchId', batch_id,
    'marId', mar_id,
    'reservationId', reservation_id,
    'inventoryLockId', lock_id
  );
end;
$$;

revoke all on function public.certify_payment_refund_fixture(text, uuid) from public;
grant execute on function public.certify_payment_refund_fixture(text, uuid) to service_role;

comment on function public.certify_payment_refund_fixture is
  'Test-only fixture builder for the payment-refund E2E suite: a confirmed, priced, payment-required reservation with an already-expired inventory lock. Not part of the application runtime; granted to service_role only.';
