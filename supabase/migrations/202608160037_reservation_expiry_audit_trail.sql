-- release_expired_inventory_holds (202607310020) already atomically
-- expires overdue reservations/locks/MARs -- FOR UPDATE OF lock SKIP
-- LOCKED, safe for concurrent workers -- but never wrote an audit
-- transition for the reservation change. Every other reservation
-- lifecycle transition (decide_reservation, mark_reservation_ready,
-- issue_pickup_credential, collect_reservation) inserts into
-- fulfillment_transitions; this system-originated expiry never did.
-- record_runtime_evidence cannot be reused here -- it requires
-- auth.uid() = target_actor_id, and this worker runs as service_role
-- with no authenticated end user -- but fulfillment_transitions has no
-- actor column at all, so it is directly reachable. The batch
-- shelf-life expiry loop below is unchanged; it already records an
-- inventory_transactions row via _record_inventory_transaction.
create or replace function public.release_expired_inventory_holds(
  target_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lock_row record;
  batch_row record;
  released_holds integer := 0;
  expired_batches integer := 0;
  operation_key text;
  content_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     or target_limit is null
     or target_limit not between 1 and 1000
  then
    raise exception 'inventory expiry worker is not authorized'
      using errcode = '42501';
  end if;

  for lock_row in
    select
      lock.id,
      lock.organization_id,
      lock.reservation_id,
      reservation.mar_id,
      reservation.status as reservation_status
    from public.inventory_locks lock
    join public.reservations reservation
      on reservation.id = lock.reservation_id
     and reservation.organization_id = lock.organization_id
    where lock.status = 'active'
      and lock.expires_at <= now()
      and reservation.status in ('pending', 'confirmed', 'ready')
    order by lock.expires_at, lock.id
    limit target_limit
    for update of lock skip locked
  loop
    operation_key := 'inventory-expiry:' || lock_row.id::text;

    update public.inventory_locks
    set status = 'expired',
        released_at = now(),
        correlation_id = operation_key,
        request_id = operation_key
    where id = lock_row.id;

    update public.reservations
    set status = 'expired',
        updated_at = now()
    where id = lock_row.reservation_id
      and status in ('pending', 'confirmed', 'ready');

    update public.medication_access_requests
    set state = 'expired',
        completed_at = coalesce(completed_at, now()),
        transition_idempotency_key = operation_key || ':mar',
        updated_at = now()
    where id = lock_row.mar_id
      and organization_id = lock_row.organization_id
      and state = 'reserved';

    insert into public.fulfillment_transitions (
      organization_id, reservation_id, from_state, to_state, step,
      idempotency_key, correlation_id
    ) values (
      lock_row.organization_id, lock_row.reservation_id,
      lock_row.reservation_status, 'expired', 'system.expired',
      operation_key, gen_random_uuid()
    )
    on conflict (organization_id, idempotency_key) do nothing;

    released_holds := released_holds + 1;
  end loop;

  for batch_row in
    select batch.*
    from public.inventory_batches batch
    where batch.expires_on < current_date
      and batch.status in ('available', 'quarantined')
      and batch.deleted_at is null
      and not exists (
        select 1
        from public.inventory_locks lock
        where lock.inventory_batch_id = batch.id
          and lock.organization_id = batch.organization_id
          and lock.status = 'active'
      )
    order by batch.expires_on, batch.id
    limit target_limit
    for update skip locked
  loop
    operation_key :=
      'inventory-batch-expiry:' || batch_row.id::text || ':'
      || current_date::text;
    content_hash := encode(
      public.digest(
        convert_to(
          jsonb_build_object(
            'inventoryId', batch_row.id,
            'expiresOn', batch_row.expires_on,
            'status', 'expired'
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    update public.inventory_batches
    set status = 'expired'
    where id = batch_row.id;

    perform public._record_inventory_transaction(
      batch_row.organization_id,
      batch_row.id,
      'expiry',
      0,
      0,
      batch_row.quantity_on_hand,
      batch_row.quantity_on_hand,
      batch_row.quantity_reserved,
      batch_row.quantity_reserved,
      'Inventory batch reached its expiry date',
      operation_key,
      operation_key,
      operation_key,
      content_hash,
      jsonb_build_object('expiresOn', batch_row.expires_on)
    );

    expired_batches := expired_batches + 1;
  end loop;

  return jsonb_build_object(
    'releasedHolds', released_holds,
    'expiredBatches', expired_batches
  );
end;
$$;

revoke all on function public.release_expired_inventory_holds(integer)
  from public;
grant execute on function public.release_expired_inventory_holds(integer)
  to service_role;

comment on function public.release_expired_inventory_holds is
  'Service-role worker command that releases expired holds and retires expired batches without bypassing inventory accounting. Reservation expiry now also writes a fulfillment_transitions audit row.';
