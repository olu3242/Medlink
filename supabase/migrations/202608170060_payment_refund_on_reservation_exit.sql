-- Payment convergence, part 2: the `refunds` table (migration
-- 202607270004) and its RLS have existed since Wave 1 with no writer --
-- no RPC, no route, no trigger ever inserted into it. That left a real
-- gap once 202608170059 started actually capturing money: the only path
-- that can move a *paid* reservation (payment_required, payment
-- status='captured') out of confirmed/ready is the system expiry worker
-- (release_expired_inventory_holds, 202608160037) turning it 'expired'.
-- decide_reservation only ever acts on a still-'pending' reservation, so
-- it can never cancel a paid one -- there is no pharmacy-cancels-a-paid-
-- reservation path in this schema, only expiry. Either way, nothing ever
-- refunded that captured amount or even flagged it as owed. This
-- migration closes that gap the same way 202608170059 closed the payment
-- side: a trigger creates the obligation, a signed provider webhook event
-- confirms completion. No new reservation/cancellation model -- the
-- existing status transition is the only trigger condition.

-- refunds.completed_at already exists (migration 202607270004); no schema
-- change needed here, only the writer that table has lacked since Wave 1.

-- Deterministic, non-authenticated actor: the only caller of this trigger
-- is an internal status UPDATE (the system expiry worker, or in principle
-- a future pharmacy-cancels-a-paid-reservation path), never a Supabase-
-- authenticated end user, so there is no real auth.uid() to attribute the
-- refund to. Reuses the fixed system identity ADR 0004 already provisioned
-- for exactly this "no genuine end-user session" situation
-- (202608010001_conversation_runtime_system_identity.sql) -- not used
-- there to call any actor-checked RPC, and not used that way here either;
-- refunds.initiated_by is a plain FK, not an auth.uid()-checked column.
create or replace function public.initiate_reservation_refund_on_exit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  payment_row public.payments;
  refunded_total bigint;
  outstanding bigint;
  refund_id uuid := gen_random_uuid();
  provider_refund_reference text;
  idem_key text;
begin
  if not (old.status in ('confirmed','ready') and new.status in ('cancelled','expired')) then
    return new;
  end if;

  select * into payment_row from public.payments
  where organization_id = new.organization_id
    and reservation_id = new.id
    and status = 'captured'
  order by created_at, id limit 1;
  if not found then return new; end if;

  select coalesce(sum(amount_minor),0) into refunded_total
  from public.refunds
  where organization_id = new.organization_id
    and payment_id = payment_row.id
    and status in ('pending','succeeded');
  outstanding := payment_row.amount_minor - refunded_total;
  if outstanding <= 0 then return new; end if;

  provider_refund_reference := 'medlink-refund-' || refund_id::text;
  idem_key := 'reservation-exit-refund:' || new.id::text;

  insert into public.refunds(
    id, organization_id, payment_id, amount_minor, status, reason,
    provider_refund_reference, idempotency_key, initiated_by
  ) values (
    refund_id, new.organization_id, payment_row.id, outstanding, 'pending',
    'Reservation ' || new.status::text,
    provider_refund_reference, idem_key,
    '11111111-1111-4111-8111-111111111111'
  )
  on conflict (organization_id, idempotency_key) do nothing;
  if not found then return new; end if;

  insert into public.payment_events(
    organization_id, payment_id, refund_id, event_type, idempotency_key, metadata
  ) values (
    new.organization_id, payment_row.id, refund_id, 'payment.refund-required',
    idem_key || ':event',
    jsonb_build_object('reservationId', new.id, 'refundId', refund_id, 'amountMinor', outstanding)
  );

  insert into public.governance_audit_events(
    organization_id, event_type, actor_id, actor_type, resource_type, resource_id,
    action, outcome, correlation_id, request_id, idempotency_key, source_channel, metadata
  ) values (
    new.organization_id, 'runtime.operation', null, 'system', 'payment', payment_row.id::text,
    'payment.refund-required', 'success', idem_key, idem_key, idem_key || ':audit', 'system',
    jsonb_build_object('reservationId', new.id, 'refundId', refund_id)
  );

  insert into public.runtime_outbox_events(
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    new.organization_id, 'payment.refund_required.v1', 'reservation', new.id::text,
    jsonb_build_object(
      'tenantId', new.organization_id, 'reservationId', new.id, 'paymentId', payment_row.id,
      'refundId', refund_id, 'providerRefundReference', provider_refund_reference,
      'amountMinor', outstanding, 'currency', payment_row.currency_code
    ),
    idem_key, idem_key, 'payment-refund-required:' || new.id::text
  ) on conflict (organization_id, idempotency_key) do nothing;

  return new;
end;
$$;

create trigger reservations_refund_on_exit
after update of status on public.reservations
for each row execute function public.initiate_reservation_refund_on_exit();

-- Mirrors apply_payment_provider_event exactly, one step later in the
-- same money's lifecycle: service-role-only, provider-event-reference
-- deduplicated, amount/currency-verified against the authoritative
-- refund row (never the request body alone), and safe against a refund
-- succeeding twice or a partial-then-full sequence.
create or replace function public.apply_refund_provider_event(
  target_provider_event_reference text,target_provider_refund_reference text,
  target_status text,target_amount_minor bigint,target_currency_code text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  refund_row public.refunds;
  payment_row public.payments;
  prior_event public.payment_events;
  succeeded_total bigint;
  event_kind text;
  result_outcome text;
  new_payment_status public.payment_status;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Verified provider authority is required' using errcode = '42501';
  end if;
  if target_status not in ('succeeded','failed') then
    raise exception 'Provider refund status is invalid';
  end if;
  select * into prior_event from public.payment_events
  where provider_event_reference=target_provider_event_reference;
  if found then return jsonb_build_object('outcome','duplicate','refundId',prior_event.refund_id); end if;

  select * into refund_row from public.refunds
  where provider_refund_reference=target_provider_refund_reference for update;
  if not found then return jsonb_build_object('outcome','unknown_refund'); end if;
  select * into payment_row from public.payments
  where id=refund_row.payment_id and organization_id=refund_row.organization_id for update;
  if target_amount_minor<>refund_row.amount_minor or target_currency_code<>payment_row.currency_code then
    insert into public.payment_events(
      organization_id,payment_id,refund_id,event_type,provider_event_reference,idempotency_key,metadata
    ) values (
      refund_row.organization_id,payment_row.id,refund_row.id,'payment.refund-provider-rejected',
      target_provider_event_reference,'refund-provider-event:'||target_provider_event_reference,
      jsonb_build_object('reason','amount_or_currency_mismatch')
    );
    return jsonb_build_object('outcome','rejected_mismatch','refundId',refund_row.id);
  end if;

  if refund_row.status <> 'pending' then
    event_kind := 'payment.refund-duplicate-event';
    result_outcome := 'already_settled';
  elsif target_status = 'failed' then
    update public.refunds set status='failed' where id=refund_row.id;
    event_kind := 'payment.refund-failed'; result_outcome := 'failed';
  else
    update public.refunds set status='succeeded',completed_at=now() where id=refund_row.id;
    select coalesce(sum(amount_minor),0) into succeeded_total from public.refunds
    where organization_id=payment_row.organization_id and payment_id=payment_row.id and status='succeeded';
    new_payment_status := case when succeeded_total >= payment_row.amount_minor
      then 'refunded' else 'partially_refunded' end;
    update public.payments set status=new_payment_status where id=payment_row.id;
    event_kind := 'payment.refund-succeeded'; result_outcome := 'succeeded';
  end if;

  insert into public.payment_events(
    organization_id,payment_id,refund_id,event_type,provider_event_reference,idempotency_key,metadata
  ) values (
    refund_row.organization_id,payment_row.id,refund_row.id,event_kind,target_provider_event_reference,
    'refund-provider-event:'||target_provider_event_reference,
    jsonb_build_object('refundId',refund_row.id,'outcome',result_outcome)
  );
  insert into public.governance_audit_events(
    organization_id,event_type,actor_id,actor_type,resource_type,resource_id,
    action,outcome,correlation_id,request_id,idempotency_key,source_channel,metadata
  ) values (
    refund_row.organization_id,'runtime.operation',null,'system','payment',payment_row.id::text,
    event_kind,'success',target_provider_event_reference,target_provider_event_reference,
    'refund-provider:'||target_provider_event_reference,'provider',
    jsonb_build_object('refundId',refund_row.id)
  );
  if result_outcome in ('failed','succeeded') then
    insert into public.runtime_outbox_events(
      organization_id,event_type,aggregate_type,aggregate_id,payload,
      correlation_id,request_id,idempotency_key
    ) values (
      refund_row.organization_id,
      case when result_outcome='failed' then 'payment.refund_failed.v1' else 'payment.refund_succeeded.v1' end,
      'payment',payment_row.id::text,
      jsonb_build_object('tenantId',refund_row.organization_id,'paymentId',payment_row.id,'refundId',refund_row.id),
      target_provider_event_reference,target_provider_event_reference,
      'refund-outbox:'||target_provider_event_reference
    );
  end if;
  return jsonb_build_object('outcome',result_outcome,'refundId',refund_row.id,'paymentId',payment_row.id);
end;
$$;

revoke all on function public.apply_refund_provider_event(text,text,text,bigint,text) from public;
grant execute on function public.apply_refund_provider_event(text,text,text,bigint,text) to service_role;

comment on function public.initiate_reservation_refund_on_exit is
  'Creates one pending refund for a captured, un-refunded payment whenever its reservation leaves confirmed/ready for cancelled/expired. System-attributed (no authenticated end-user session exists on this path); idempotent per reservation.';
comment on function public.apply_refund_provider_event is
  'Applies a signed provider refund confirmation to its refund and parent payment. Service-role only, provider-event deduplicated, amount/currency-verified against the authoritative refund row.';
