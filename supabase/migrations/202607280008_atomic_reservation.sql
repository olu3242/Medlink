-- Pre-deployment hardening: atomic, idempotent patient reservation command.

create or replace function public.reserve_inventory(
  target_organization_id uuid,
  target_mar_id uuid,
  target_pharmacy_location_id uuid,
  target_inventory_batch_id uuid,
  target_quantity integer,
  target_idempotency_key text,
  target_expires_at timestamptz
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_mar public.medication_access_requests;
  target_batch public.inventory_batches;
  existing_reservation public.reservations;
  existing_lock public.inventory_locks;
  created_reservation public.reservations;
begin
  if actor_id is null then
    raise exception 'Authentication is required';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Tenant membership is invalid';
  end if;
  if target_quantity is null or target_quantity <= 0 then
    raise exception 'Reservation quantity must be positive';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;
  if target_expires_at is null or target_expires_at <= now() then
    raise exception 'Reservation expiry must be in the future';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || target_idempotency_key, 0)
  );

  select *
  into existing_reservation
  from public.reservations
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;

  if found then
    select *
    into existing_lock
    from public.inventory_locks
    where organization_id = target_organization_id
      and reservation_id = existing_reservation.id;

    if not found then
      raise exception 'Existing reservation has no inventory lock';
    end if;
    if existing_reservation.mar_id <> target_mar_id
       or existing_reservation.pharmacy_location_id <> target_pharmacy_location_id
       or existing_lock.inventory_batch_id <> target_inventory_batch_id
       or existing_lock.quantity <> target_quantity then
      raise exception 'Idempotency key was already used for a different reservation';
    end if;
    return existing_reservation;
  end if;

  select *
  into target_mar
  from public.medication_access_requests
  where id = target_mar_id
    and organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'Medication access request was not found';
  end if;
  if target_mar.patient_id <> actor_id then
    raise exception 'Only the patient may create this reservation';
  end if;
  if target_mar.state <> 'matched'::public.mar_status then
    raise exception 'A reservation requires a matched medication access request';
  end if;

  select *
  into target_batch
  from public.inventory_batches
  where id = target_inventory_batch_id
    and organization_id = target_organization_id
    and pharmacy_location_id = target_pharmacy_location_id
  for update;

  if not found then
    raise exception 'Inventory batch was not found at the selected pharmacy';
  end if;
  if target_batch.status <> 'available'::public.inventory_batch_status
     or target_batch.expires_on < current_date
     or target_batch.available_quantity < target_quantity then
    raise exception 'Requested inventory is unavailable';
  end if;

  insert into public.reservations (
    organization_id,
    mar_id,
    patient_id,
    pharmacy_location_id,
    idempotency_key,
    expires_at,
    created_by
  ) values (
    target_organization_id,
    target_mar_id,
    actor_id,
    target_pharmacy_location_id,
    target_idempotency_key,
    target_expires_at,
    actor_id
  )
  returning * into created_reservation;

  insert into public.inventory_locks (
    organization_id,
    reservation_id,
    inventory_batch_id,
    quantity,
    idempotency_key,
    expires_at
  ) values (
    target_organization_id,
    created_reservation.id,
    target_inventory_batch_id,
    target_quantity,
    target_idempotency_key || ':inventory',
    target_expires_at
  );

  update public.medication_access_requests
  set state = 'reserved'::public.mar_status,
      transition_idempotency_key = target_idempotency_key || ':mar',
      updated_at = now()
  where id = target_mar_id
    and organization_id = target_organization_id;

  return created_reservation;
end;
$$;

revoke all on function public.reserve_inventory(
  uuid, uuid, uuid, uuid, integer, text, timestamptz
) from public;
grant execute on function public.reserve_inventory(
  uuid, uuid, uuid, uuid, integer, text, timestamptz
) to authenticated;

comment on function public.reserve_inventory(
  uuid, uuid, uuid, uuid, integer, text, timestamptz
) is
  'Atomically creates an idempotent patient reservation, locks inventory, and transitions its matched MAR.';
