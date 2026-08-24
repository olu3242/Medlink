-- MedLink pharmacy onboarding/inventory harmonization pass: reserve_inventory
-- was the one inventory-authority RPC that never checked whether the
-- pharmacy location it was reserving against was still active.
-- search_inventory_availability (202607310020) already excludes inactive
-- locations from discovery, and create_inventory_batch (202607310020)
-- already refuses to create stock against an inactive/deleted location --
-- but reserve_inventory only checked that the supplied batch's
-- pharmacy_location_id equalled the caller's target_pharmacy_location_id,
-- never that the location was still `is_active` / not soft-deleted. A
-- caller holding a still-'available' inventory_batch_id at a location that
-- has since been deactivated (or soft-deleted) could still reserve it --
-- the one inventory write path that did not fail closed on pharmacy
-- lifecycle state. This reuses the exact `is_active and deleted_at is
-- null` predicate create_inventory_batch already applies to
-- pharmacy_locations; it is not a new lifecycle/state model. Ported
-- forward onto 202608170062's medicine-identity-guarded body (the actual
-- latest version), adding one condition, not reverting either of its
-- guarantees (medicine identity match, replay-payload validation).
create or replace function public.reserve_inventory(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_mar_id uuid,
  target_pharmacy_location_id uuid,
  target_inventory_batch_id uuid,
  target_quantity integer,
  target_expires_at timestamptz
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  mar public.medication_access_requests;
  batch public.inventory_batches;
  existing public.reservations;
  existing_lock public.inventory_locks;
  created public.reservations;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Tenant membership is invalid';
  end if;
  if target_quantity is null or target_quantity <= 0 then
    raise exception 'Reservation quantity must be positive';
  end if;
  if target_expires_at <= now() then
    raise exception 'Reservation expiry must be in the future';
  end if;

  select * into existing from public.reservations
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    select * into existing_lock from public.inventory_locks
    where organization_id = target_organization_id
      and reservation_id = existing.id;
    if not found then
      raise exception 'Existing reservation has no inventory lock';
    end if;
    if existing.mar_id <> target_mar_id
       or existing.pharmacy_location_id <> target_pharmacy_location_id
       or existing_lock.inventory_batch_id <> target_inventory_batch_id
       or existing_lock.quantity <> target_quantity then
      raise exception 'Idempotency key was already used for a different reservation';
    end if;
    return existing;
  end if;

  select * into mar from public.medication_access_requests
  where id = target_mar_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Medication access request not found';
  end if;

  if mar.patient_id is distinct from target_actor_id
     and not public.has_organization_role(
       target_organization_id,
       array['pharmacist', 'pharmacy_staff']::public.member_role[]
     )
  then
    raise exception 'Actor may not reserve inventory for this medication access request';
  end if;

  if mar.state <> 'matched' then
    raise exception 'Medication access request must be matched before reservation';
  end if;

  if not exists (
    select 1
    from public.pharmacy_locations location
    where location.id = target_pharmacy_location_id
      and location.organization_id = target_organization_id
      and location.is_active
      and location.deleted_at is null
  ) then
    raise exception 'Pharmacy location is not active';
  end if;

  select * into batch from public.inventory_batches
  where id = target_inventory_batch_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Inventory batch not found';
  end if;
  if batch.medicine_id is distinct from mar.requested_medicine_id then
    raise exception 'Inventory batch does not match the requested medicine';
  end if;
  if batch.pharmacy_location_id is distinct from target_pharmacy_location_id then
    raise exception 'Inventory batch does not belong to the requested pharmacy location';
  end if;
  if batch.status <> 'available' or batch.expires_on < current_date then
    raise exception 'Inventory batch is not available';
  end if;

  begin
    insert into public.reservations (
      organization_id, mar_id, patient_id, pharmacy_location_id, status,
      idempotency_key, expires_at, created_by
    ) values (
      target_organization_id, target_mar_id, mar.patient_id,
      target_pharmacy_location_id, 'pending', target_idempotency_key,
      target_expires_at, target_actor_id
    )
    returning * into created;
  exception when unique_violation then
    raise exception 'An open reservation already exists for this medication access request';
  end;

  insert into public.inventory_locks (
    organization_id, reservation_id, inventory_batch_id, quantity,
    idempotency_key, expires_at
  ) values (
    target_organization_id, created.id, target_inventory_batch_id,
    target_quantity, target_idempotency_key, target_expires_at
  );

  update public.medication_access_requests
  set state = 'reserved', transition_idempotency_key = target_idempotency_key
  where id = target_mar_id and organization_id = target_organization_id;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.create',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', created.id::text, null,
    jsonb_build_object(
      'status', created.status, 'marId', target_mar_id,
      'inventoryBatchId', target_inventory_batch_id, 'quantity', target_quantity
    ),
    null, null, target_channel, 'reservation.created',
    jsonb_build_object('reservationId', created.id, 'marId', target_mar_id)
  );

  return created;
end;
$$;

revoke all on function public.reserve_inventory(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, integer, timestamptz
) from public;
grant execute on function public.reserve_inventory(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, integer, timestamptz
) to authenticated;

comment on function public.reserve_inventory(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, integer, timestamptz
) is
  'Atomic reservation creation: authorization, canonical medicine identity match (mirrors match_inventory), active-pharmacy-location guard (mirrors create_inventory_batch), reservation row, inventory lock (enforced by sync_inventory_lock_quantity), MAR matched->reserved transition, and runtime evidence all commit or roll back together. Idempotent on (organization_id, idempotency_key), validating the replay payload matches the original reservation rather than trusting the key alone.';
