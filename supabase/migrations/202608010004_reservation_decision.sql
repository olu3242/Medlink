-- RC1 reservation/fulfillment harmonization: atomic pharmacy decision.
create or replace function public.decide_reservation(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_reservation_id uuid,
  target_decision text,
  target_reason text
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reservation public.reservations;
  prior_transition public.fulfillment_transitions;
  target_status public.reservation_status;
  event_name text;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) or not public.has_organization_role(
    target_organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ) then
    raise exception 'Reservation decision requires pharmacy staff or pharmacist role';
  end if;
  if target_decision not in ('confirmed', 'declined') then
    raise exception 'Reservation decision is invalid';
  end if;
  if char_length(btrim(target_reason)) < 3 then
    raise exception 'Reservation decision reason is required';
  end if;

  target_status := case when target_decision = 'confirmed'
    then 'confirmed'::public.reservation_status
    else 'cancelled'::public.reservation_status end;
  event_name := case when target_decision = 'confirmed'
    then 'reservation.confirmed.v1' else 'reservation.cancelled.v1' end;

  select * into prior_transition from public.fulfillment_transitions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if prior_transition.reservation_id <> target_reservation_id
       or prior_transition.to_state <> target_status::text then
      raise exception 'Idempotency key was already used for a different reservation decision';
    end if;
    select * into current_reservation from public.reservations
    where id = target_reservation_id and organization_id = target_organization_id;
    return current_reservation;
  end if;

  select * into current_reservation from public.reservations
  where id = target_reservation_id and organization_id = target_organization_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status <> 'pending' then
    raise exception 'Only a pending reservation may receive a pharmacy decision';
  end if;

  update public.reservations set
    status = target_status,
    confirmed_at = case when target_status = 'confirmed' then now() else confirmed_at end,
    cancelled_at = case when target_status = 'cancelled' then now() else cancelled_at end
  where id = target_reservation_id and organization_id = target_organization_id
  returning * into current_reservation;

  if target_status = 'cancelled' then
    update public.inventory_locks set status = 'released', released_at = now()
    where reservation_id = target_reservation_id
      and organization_id = target_organization_id and status = 'active';
  end if;

  insert into public.fulfillment_transitions (
    organization_id, reservation_id, from_state, to_state, step,
    idempotency_key, correlation_id
  ) values (
    target_organization_id, target_reservation_id, 'pending', target_status::text,
    'pharmacy.' || target_decision, target_idempotency_key,
    target_correlation_id::uuid
  );

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.decide', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', target_reservation_id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', target_status, 'reason', btrim(target_reason)),
    null, null, target_channel, event_name,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'reservationId', target_reservation_id,
      'reason', btrim(target_reason)
    )
  );
  return current_reservation;
end;
$$;

revoke all on function public.decide_reservation(
  uuid, uuid, text, text, text, text, uuid, text, text
) from public;
grant execute on function public.decide_reservation(
  uuid, uuid, text, text, text, text, uuid, text, text
) to authenticated;

comment on function public.decide_reservation is
  'Atomically confirms or declines a pending reservation, compensates its inventory lock on decline, appends fulfillment history, and records runtime/outbox evidence.';
