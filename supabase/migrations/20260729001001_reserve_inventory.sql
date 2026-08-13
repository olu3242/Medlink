-- Sprint 1 (RC1 P0 convergence): reserve_inventory.
--
-- apps/patient/lib/application.ts's AccessApplication.reserve() has called
-- this RPC since the file was first committed; it was never defined, so the
-- reservation-creation path has 500'd unconditionally (see
-- docs/audit/RC1_BACKLOG.md P1 item 19 and the certification report from the
-- prior pass).
--
-- This does not invent new concurrency machinery: the schema already has it.
-- inventory_locks' sync_inventory_lock_quantity() trigger (migration
-- 202607270003) atomically moves quantity from inventory_batches into a lock
-- via an UPDATE ... WHERE that only succeeds if enough unreserved stock
-- exists, raising 'Insufficient or unavailable inventory for lock'
-- otherwise -- Postgres's row-level locking makes this safe under
-- concurrent callers without any extra version column or retry loop. This
-- function's job is only to orchestrate the existing tables in one
-- transaction: verify authorization, create the reservation, create the
-- lock (which the trigger enforces), advance the MAR's state machine (an
-- already-legal 'matched' -> 'reserved' transition per
-- enforce_and_audit_mar_state()), and record evidence -- all atomically, so
-- any failure at any step rolls back everything before it.

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

  -- Idempotent replay: return the prior result rather than re-running side
  -- effects (mirrors record_runtime_evidence's own on-conflict pattern).
  select * into existing from public.reservations
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    return existing;
  end if;

  select * into mar from public.medication_access_requests
  where id = target_mar_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Medication access request not found';
  end if;

  -- Mirrors the reservations_create RLS policy exactly: this function is
  -- SECURITY DEFINER and therefore bypasses RLS, so it must re-enforce the
  -- same authorization the policy would (patient reserving their own
  -- request, or clinical/pharmacy staff reserving on their behalf).
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

  select * into batch from public.inventory_batches
  where id = target_inventory_batch_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Inventory batch not found';
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

  -- Raises 'Insufficient or unavailable inventory for lock' and rolls back
  -- the whole function, including the reservation insert above, if
  -- target_quantity exceeds what sync_inventory_lock_quantity() can commit.
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
  'Atomic reservation creation: authorization, reservation row, inventory lock (enforced by sync_inventory_lock_quantity), MAR matched->reserved transition, and runtime evidence all commit or roll back together. Idempotent on (organization_id, idempotency_key).';
