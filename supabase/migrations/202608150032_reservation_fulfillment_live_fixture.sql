-- Service-role-only fixture helper for live CI certification of the
-- reservation fulfillment lifecycle (decide_reservation,
-- mark_reservation_ready, collect_reservation). It exists only to build a
-- batch of real 'pending' reservations under real authenticated actors so
-- packages/runtime/src/reservation-fulfillment-live.test.ts can exercise
-- those RPCs end to end against a live database, the same way
-- certify_merdp_wave1_golden_lineage exists only to seed MERDP certification
-- fixtures. It composes existing table invariants directly (rather than the
-- create_mar/validate_mar/decide_clinical_review RPCs) because those RPCs
-- authenticate as a single caller per call and this fixture must produce
-- rows attributable to several distinct actors in one service-role
-- transaction; the state machine and its guarding trigger
-- (medication_access_requests_state_guard) are still walked transition by
-- transition, not bypassed.
create or replace function public.certify_reservation_fulfillment_fixture(
  fixture_key text,
  patient_id uuid,
  pharmacist_id uuid,
  pharmacy_staff_id uuid,
  wrong_role_id uuid,
  other_tenant_pharmacist_id uuid,
  other_tenant_patient_id uuid,
  reservation_keys text[]
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
  batch_id uuid := gen_random_uuid();
  medicine_id uuid := gen_random_uuid();
  reservation_map jsonb := '{}'::jsonb;
  reservation_key text;
  mar_id uuid;
  reservation_id uuid;
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  -- Its own medicine, not a lookup into the MERDP catalog: a clean
  -- `supabase db reset` has no medicines rows at all (there is no
  -- supabase/seed.sql, and canonical catalog data is loaded by the
  -- tools/nafdac_* ETL pipeline, not by a migration), so this fixture must
  -- not depend on catalog data being present.
  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values (
    medicine_id, 'Fixture Medicine ' || fixture_key, 'fixture-generic-' || fixture_key,
    'tablet', 'oral', '500mg', 'active'
  );

  insert into public.organizations(id, name, slug, type) values
    (organization_id, 'Fulfillment Cert ' || fixture_key, 'fulfillment-cert-' || fixture_key, 'pharmacy'),
    (other_organization_id, 'Fulfillment Cert Other ' || fixture_key, 'fulfillment-cert-other-' || fixture_key, 'pharmacy');

  insert into public.user_profiles(id, display_name) values
    (patient_id, 'Fixture Patient'),
    (pharmacist_id, 'Fixture Pharmacist'),
    (pharmacy_staff_id, 'Fixture Pharmacy Staff'),
    (wrong_role_id, 'Fixture Wrong Role'),
    (other_tenant_pharmacist_id, 'Fixture Other Tenant Pharmacist'),
    (other_tenant_patient_id, 'Fixture Other Tenant Patient')
  on conflict (id) do nothing;

  insert into public.organization_memberships(organization_id, user_id, role) values
    (organization_id, patient_id, 'patient'),
    (organization_id, pharmacist_id, 'pharmacist'),
    (organization_id, pharmacy_staff_id, 'pharmacy_staff'),
    (organization_id, wrong_role_id, 'inventory_manager'),
    (other_organization_id, other_tenant_pharmacist_id, 'pharmacist'),
    (other_organization_id, other_tenant_patient_id, 'patient');

  insert into public.pharmacy_locations(
    id, organization_id, name, address_line_1, locality, country_code, latitude, longitude
  ) values (
    location_id, organization_id, 'Fulfillment Cert Pharmacy', '1 Certification Way',
    'Lagos', 'NG', 6.5244, 3.3792
  );

  insert into public.inventory_batches(
    id, organization_id, pharmacy_location_id, medicine_id, batch_number, expires_on,
    quantity_on_hand, unit, status, created_by
  ) values (
    batch_id, organization_id, location_id, medicine_id, 'FULFILL-' || fixture_key, '2099-12-31',
    array_length(reservation_keys, 1) + 5, 'tablet', 'available', pharmacist_id
  );

  foreach reservation_key in array reservation_keys loop
    mar_id := gen_random_uuid();

    insert into public.medication_access_requests(
      id, organization_id, patient_id, requested_medicine_id, state,
      transition_idempotency_key, created_by
    ) values (
      mar_id, organization_id, patient_id, medicine_id, 'created',
      'fixture-mar-created-' || fixture_key || '-' || reservation_key, patient_id
    );
    update public.medication_access_requests set state = 'validated',
      transition_idempotency_key = 'fixture-mar-validated-' || fixture_key || '-' || reservation_key
      where id = mar_id;

    insert into public.clinical_reviews(
      organization_id, mar_id, decision, reviewed_by, reviewed_at, idempotency_key
    ) values (
      organization_id, mar_id, 'approved', pharmacist_id, now(),
      'fixture-review-' || fixture_key || '-' || reservation_key
    );
    update public.medication_access_requests set state = 'reviewed',
      transition_idempotency_key = 'fixture-mar-reviewed-' || fixture_key || '-' || reservation_key
      where id = mar_id;
    update public.medication_access_requests set state = 'searching',
      transition_idempotency_key = 'fixture-mar-searching-' || fixture_key || '-' || reservation_key
      where id = mar_id;
    update public.medication_access_requests set state = 'matched',
      transition_idempotency_key = 'fixture-mar-matched-' || fixture_key || '-' || reservation_key
      where id = mar_id;

    reservation_id := gen_random_uuid();
    insert into public.reservations(
      id, organization_id, mar_id, patient_id, pharmacy_location_id, status,
      idempotency_key, expires_at, created_by
    ) values (
      reservation_id, organization_id, mar_id, patient_id, location_id, 'pending',
      'fixture-reservation-' || fixture_key || '-' || reservation_key, now() + interval '1 day', patient_id
    );
    insert into public.inventory_locks(
      organization_id, reservation_id, inventory_batch_id, quantity, status,
      idempotency_key, expires_at
    ) values (
      organization_id, reservation_id, batch_id, 1, 'active',
      'fixture-lock-' || fixture_key || '-' || reservation_key, now() + interval '1 day'
    );

    reservation_map := reservation_map || jsonb_build_object(reservation_key, reservation_id);
  end loop;

  return jsonb_build_object(
    'organizationId', organization_id,
    'otherOrganizationId', other_organization_id,
    'pharmacyLocationId', location_id,
    'inventoryBatchId', batch_id,
    'reservations', reservation_map
  );
end;
$$;

revoke all on function public.certify_reservation_fulfillment_fixture(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text[]
) from public;
grant execute on function public.certify_reservation_fulfillment_fixture(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text[]
) to service_role;

comment on function public.certify_reservation_fulfillment_fixture is
  'Test-only fixture builder for live CI certification of the reservation fulfillment lifecycle. Not part of the application runtime; granted to service_role only.';
