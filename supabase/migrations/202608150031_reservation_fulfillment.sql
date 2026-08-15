-- F2/F3: confirmed -> ready -> collected. Both RPCs deal only in a SHA-256
-- hash of the pickup credential -- the plaintext is generated and verified
-- in the calling TypeScript layer (apps/pharmacy/lib/reservations.ts) and
-- never reaches Postgres, so it can never appear in a function argument
-- log, runtime evidence payload, or fulfillment_transitions row. Both
-- functions strip pickup_code_hash from their jsonb return value too, so
-- the hash itself is never echoed back to a client either.

create or replace function public.mark_reservation_ready(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_reservation_id uuid,
  target_pickup_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reservation public.reservations;
  prior_transition public.fulfillment_transitions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) or not public.has_organization_role(
    target_organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ) then
    raise exception 'Marking a reservation ready requires pharmacy staff or pharmacist role';
  end if;
  if target_pickup_code_hash is null or char_length(target_pickup_code_hash) <> 64 then
    raise exception 'A valid pickup credential hash is required';
  end if;

  -- Idempotent replay never re-persists (and so never rotates) the
  -- credential hash: a repeated call with the same key returns the
  -- reservation as it already stands. The caller cannot recover the
  -- original plaintext from a replay -- it was never stored anywhere.
  select * into prior_transition from public.fulfillment_transitions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if prior_transition.reservation_id <> target_reservation_id
       or prior_transition.to_state <> 'ready' then
      raise exception 'Idempotency key was already used for a different reservation decision';
    end if;
    select * into current_reservation from public.reservations
    where id = target_reservation_id and organization_id = target_organization_id;
    return (to_jsonb(current_reservation) - 'pickup_code_hash')
      || jsonb_build_object('isNewTransition', false);
  end if;

  select * into current_reservation from public.reservations
  where id = target_reservation_id and organization_id = target_organization_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status <> 'confirmed' then
    raise exception 'Only a confirmed reservation may be marked ready';
  end if;

  update public.reservations set
    status = 'ready',
    pickup_code_hash = target_pickup_code_hash
  where id = target_reservation_id and organization_id = target_organization_id
  returning * into current_reservation;

  insert into public.fulfillment_transitions (
    organization_id, reservation_id, from_state, to_state, step, idempotency_key, correlation_id
  ) values (
    target_organization_id, target_reservation_id, 'confirmed', 'ready', 'pharmacy.ready',
    target_idempotency_key, target_correlation_id::uuid
  );

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.ready', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', target_reservation_id::text,
    jsonb_build_object('status', 'confirmed'), jsonb_build_object('status', 'ready'),
    null, null, target_channel, 'reservation.ready.v1',
    jsonb_build_object('tenantId', target_organization_id, 'reservationId', target_reservation_id)
  );
  return (to_jsonb(current_reservation) - 'pickup_code_hash')
    || jsonb_build_object('isNewTransition', true);
end;
$$;

revoke all on function public.mark_reservation_ready(
  uuid, uuid, text, text, text, text, uuid, text
) from public;
grant execute on function public.mark_reservation_ready(
  uuid, uuid, text, text, text, text, uuid, text
) to authenticated;

comment on function public.mark_reservation_ready is
  'Transitions a confirmed reservation to ready and stores the caller-supplied pickup-credential hash. Idempotent replay never rotates the credential. Inventory lock is untouched -- stock stays protected through to collection.';

create or replace function public.collect_reservation(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_reservation_id uuid,
  target_pickup_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reservation public.reservations;
  prior_transition public.fulfillment_transitions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) or not public.has_organization_role(
    target_organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ) then
    raise exception 'Collecting a reservation requires pharmacy staff or pharmacist role';
  end if;
  if target_pickup_code_hash is null or char_length(target_pickup_code_hash) <> 64 then
    raise exception 'A pickup credential is required';
  end if;

  select * into prior_transition from public.fulfillment_transitions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if prior_transition.reservation_id <> target_reservation_id
       or prior_transition.to_state <> 'collected' then
      raise exception 'Idempotency key was already used for a different reservation decision';
    end if;
    select * into current_reservation from public.reservations
    where id = target_reservation_id and organization_id = target_organization_id;
    return to_jsonb(current_reservation) - 'pickup_code_hash';
  end if;

  select * into current_reservation from public.reservations
  where id = target_reservation_id and organization_id = target_organization_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status <> 'ready' then
    raise exception 'Only a reservation marked ready may be collected';
  end if;
  -- Wrong or missing credential and "no credential was ever issued" (a
  -- reservation that somehow reached 'ready' with a null hash, which the
  -- schema should never actually produce) both fail the same way: a
  -- reservation-scoped mismatch, not a distinguishable oracle.
  if current_reservation.pickup_code_hash is distinct from target_pickup_code_hash then
    raise exception 'Pickup credential is invalid';
  end if;

  update public.reservations set
    status = 'collected',
    collected_at = now(),
    pickup_code_hash = null
  where id = target_reservation_id and organization_id = target_organization_id
  returning * into current_reservation;

  update public.inventory_locks set status = 'consumed', consumed_at = now()
  where reservation_id = target_reservation_id
    and organization_id = target_organization_id and status = 'active';

  insert into public.fulfillment_transitions (
    organization_id, reservation_id, from_state, to_state, step, idempotency_key, correlation_id
  ) values (
    target_organization_id, target_reservation_id, 'ready', 'collected', 'pharmacy.collected',
    target_idempotency_key, target_correlation_id::uuid
  );

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.collect', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', target_reservation_id::text,
    jsonb_build_object('status', 'ready'), jsonb_build_object('status', 'collected'),
    null, null, target_channel, 'reservation.collected.v1',
    jsonb_build_object('tenantId', target_organization_id, 'reservationId', target_reservation_id)
  );
  return to_jsonb(current_reservation) - 'pickup_code_hash';
end;
$$;

revoke all on function public.collect_reservation(
  uuid, uuid, text, text, text, text, uuid, text
) from public;
grant execute on function public.collect_reservation(
  uuid, uuid, text, text, text, text, uuid, text
) to authenticated;

comment on function public.collect_reservation is
  'Atomically transitions a ready reservation to collected and consumes its inventory lock, but only when the caller-supplied credential hash matches the one stored by mark_reservation_ready. Clears the stored hash on success so a reused credential cannot collect twice.';
