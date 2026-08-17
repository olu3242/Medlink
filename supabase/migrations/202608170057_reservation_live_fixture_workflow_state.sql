-- Migration 055 correctly requires a collected reservation to belong to a
-- reserved MAR. The older service-only live fixture inserted pending
-- reservations after stopping MARs at matched. Wrap that fixture so its
-- synthetic reservation state mirrors the production reserve_inventory RPC.
alter function public.certify_reservation_fulfillment_fixture(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text[]
) rename to certify_reservation_fulfillment_fixture_base;

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
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service-role certification context required'
      using errcode = '42501';
  end if;

  select public.certify_reservation_fulfillment_fixture_base(
    fixture_key,
    patient_id,
    pharmacist_id,
    pharmacy_staff_id,
    wrong_role_id,
    other_tenant_pharmacist_id,
    other_tenant_patient_id,
    reservation_keys
  ) into result;

  update public.medication_access_requests request
  set state = 'reserved',
      transition_idempotency_key =
        'fixture-mar-reserved-' || fixture_key || '-' || reservation_entry.key
  from public.reservations reservation,
       lateral jsonb_each_text(result->'reservations') reservation_entry
  where request.organization_id = (result->>'organizationId')::uuid
    and request.state = 'matched'::public.mar_status
    and reservation.organization_id = request.organization_id
    and reservation.mar_id = request.id
    and reservation.id = reservation_entry.value::uuid;

  return result;
end;
$$;

revoke all on function public.certify_reservation_fulfillment_fixture(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text[]
) from public, anon, authenticated;
grant execute on function public.certify_reservation_fulfillment_fixture(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text[]
) to service_role;
