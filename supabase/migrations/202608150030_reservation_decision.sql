-- Reservation/fulfillment convergence: the pharmacy decision boundary
-- RC2_GOLDEN_PATH.md names as "MISSING E2E -- legacy reservation page;
-- backing routes absent". apps/pharmacy/app/reservations/page.tsx already
-- ships and already calls PATCH /api/v1/reservations/:id -- this migration
-- is the missing database side of that already-shipped contract, not a
-- new capability invented from scratch.
--
-- Adapted from PR #18's decide_reservation (branch
-- reconcile/post-rc1-local-integration, migration 202608010004), which
-- audit confirmed is schema-compatible with current main unchanged: the
-- reservations table already has confirmed_at/cancelled_at, inventory_locks
-- already has a 'released' status, and record_runtime_evidence's signature
-- is unchanged since PR #18 branched. Two things are new here, not carried
-- over from PR #18: the reason column on fulfillment_transitions (PR #18
-- had nowhere to persist one), and the confirm-optional/decline-required
-- reason policy itself (PR #18 required a reason on every decision).

alter table public.fulfillment_transitions
  add column reason text
  check (reason is null or char_length(btrim(reason)) >= 3);

comment on column public.fulfillment_transitions.reason is
  'Optional for most transitions; the pharmacy decision RPC enforces it is present and meaningful specifically for a cancellation, not via this column-level check alone.';

create or replace function public.decide_reservation(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_reservation_id uuid,
  target_status text,
  target_reason text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reservation public.reservations;
  prior_transition public.fulfillment_transitions;
  event_name text;
  normalized_reason text;
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
  if target_status not in ('confirmed', 'cancelled') then
    raise exception 'Reservation decision status is invalid';
  end if;

  -- Canonical policy: a successful fulfillment transition (confirm) is an
  -- attributable action alone; an exception transition (cancel/decline) is
  -- an attributable action *and* a rationale. Never a synthesized one --
  -- an absent or whitespace-only reason on cancel is a hard rejection, not
  -- a value to paper over.
  normalized_reason := nullif(btrim(coalesce(target_reason, '')), '');
  if target_status = 'cancelled' and (normalized_reason is null or char_length(normalized_reason) < 3) then
    raise exception 'A meaningful reason is required to cancel a reservation';
  end if;

  event_name := case when target_status = 'confirmed'
    then 'reservation.confirmed.v1' else 'reservation.cancelled.v1' end;

  select * into prior_transition from public.fulfillment_transitions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if prior_transition.reservation_id <> target_reservation_id
       or prior_transition.to_state <> target_status then
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
    status = target_status::public.reservation_status,
    confirmed_at = case when target_status = 'confirmed' then now() else confirmed_at end,
    cancelled_at = case when target_status = 'cancelled' then now() else cancelled_at end
  where id = target_reservation_id and organization_id = target_organization_id
  returning * into current_reservation;

  -- Confirm deliberately does not touch the inventory lock -- it stays
  -- 'active', protecting the stock through to collection. Only a decline
  -- releases it, since the reservation is no longer going ahead.
  if target_status = 'cancelled' then
    update public.inventory_locks set status = 'released', released_at = now()
    where reservation_id = target_reservation_id
      and organization_id = target_organization_id and status = 'active';
  end if;

  insert into public.fulfillment_transitions (
    organization_id, reservation_id, from_state, to_state, step,
    idempotency_key, correlation_id, reason
  ) values (
    target_organization_id, target_reservation_id, 'pending', target_status,
    'pharmacy.' || target_status, target_idempotency_key,
    target_correlation_id::uuid, normalized_reason
  );

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.decide', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', target_reservation_id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', target_status)
      || case when normalized_reason is not null
           then jsonb_build_object('reason', normalized_reason)
           else '{}'::jsonb end,
    null, null, target_channel, event_name,
    jsonb_build_object('tenantId', target_organization_id, 'reservationId', target_reservation_id)
      || case when normalized_reason is not null
           then jsonb_build_object('reason', normalized_reason)
           else '{}'::jsonb end
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
  'Atomically confirms or cancels a pending reservation. Confirm requires only actor attribution; cancel additionally requires a meaningful, never-synthesized reason. Releases the inventory lock on cancel only, appends fulfillment history with the reason when present, and records runtime/outbox evidence.';
