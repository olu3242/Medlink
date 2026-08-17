-- One canonical payment obligation per priced reservation, with retryable
-- provider attempts. Payment failure never owns inventory release; the
-- existing reservation cancellation/expiry lifecycle remains authoritative.
create type public.payment_attempt_status as enum (
  'pending', 'failed', 'succeeded', 'reconciliation_required'
);

alter table public.reservations
  add column payment_required boolean not null default false;

alter table public.payments
  add column reconciliation_required boolean not null default false;

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  payment_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  provider text not null,
  provider_reference text not null unique,
  status public.payment_attempt_status not null default 'pending',
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  failed_at timestamptz,
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (payment_id, organization_id)
    references public.payments(id, organization_id) on delete restrict
);

create index payment_attempts_payment_idx
  on public.payment_attempts(payment_id, created_at, id);

alter table public.payment_attempts enable row level security;
create policy payment_attempts_read on public.payment_attempts
for select to authenticated using (exists (
  select 1 from public.payments payment
  where payment.id = payment_id
    and payment.organization_id = organization_id
    and (
      payment.patient_id = auth.uid()
      or public.has_organization_role(
        payment.organization_id,
        array['platform_admin','tenant_admin','pharmacy_owner','pharmacy_staff']::public.member_role[]
      )
    )
));

create or replace function public.set_reservation_payment_requirement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare priced boolean;
begin
  if old.status = 'pending' and new.status = 'confirmed' then
    select batch.unit_price_minor is not null and batch.unit_price_currency_code is not null
      into priced
    from public.inventory_locks lock
    join public.inventory_batches batch on batch.id = lock.inventory_batch_id
      and batch.organization_id = lock.organization_id
    where lock.reservation_id = new.id and lock.organization_id = new.organization_id
      and lock.status = 'active';
    new.payment_required := coalesce(priced,false);
  end if;
  return new;
end;
$$;

create or replace function public.apply_payment_provider_event(
  target_provider_event_reference text,target_provider_reference text,
  target_status text,target_amount_minor bigint,target_currency_code text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  attempt_row public.payment_attempts;
  payment_row public.payments;
  reservation_row public.reservations;
  lock_active boolean;
  prior_event public.payment_events;
  event_kind text;
  result_outcome text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Verified provider authority is required' using errcode = '42501';
  end if;
  if target_status not in ('succeeded','failed') then
    raise exception 'Provider payment status is invalid';
  end if;
  select * into prior_event from public.payment_events
  where provider_event_reference=target_provider_event_reference;
  if found then return jsonb_build_object('outcome','duplicate','paymentId',prior_event.payment_id); end if;
  select * into attempt_row from public.payment_attempts
  where provider_reference=target_provider_reference for update;
  if not found then return jsonb_build_object('outcome','unknown_payment'); end if;
  select * into payment_row from public.payments
  where id=attempt_row.payment_id and organization_id=attempt_row.organization_id for update;
  select * into reservation_row from public.reservations
  where id=payment_row.reservation_id and organization_id=payment_row.organization_id for update;
  if target_amount_minor<>payment_row.amount_minor or target_currency_code<>payment_row.currency_code then
    insert into public.payment_events(
      organization_id,payment_id,event_type,provider_event_reference,idempotency_key,metadata
    ) values (
      payment_row.organization_id,payment_row.id,'payment.provider-rejected',target_provider_event_reference,
      'provider-event:'||target_provider_event_reference,
      jsonb_build_object('reason','amount_or_currency_mismatch','attemptId',attempt_row.id)
    );
    return jsonb_build_object('outcome','rejected_mismatch','paymentId',payment_row.id);
  end if;
  if target_status='failed' then
    update public.payment_attempts set status='failed',failed_at=now()
    where id=attempt_row.id and status='pending';
    event_kind := 'payment.failed'; result_outcome := 'failed';
  else
    select exists(select 1 from public.inventory_locks lock
      where lock.reservation_id=reservation_row.id
        and lock.organization_id=reservation_row.organization_id and lock.status='active') into lock_active;
    if reservation_row.status<>'confirmed' or reservation_row.expires_at<=now() or not lock_active then
      update public.payment_attempts set status='reconciliation_required',succeeded_at=now()
      where id=attempt_row.id;
      update public.payments set status='authorized',reconciliation_required=true,
        authorized_at=coalesce(authorized_at,now()),
        provider_payment_reference=coalesce(provider_payment_reference,target_provider_reference)
      where id=payment_row.id;
      event_kind := 'payment.late-success-reconciliation'; result_outcome := 'reconciliation_required';
    elsif payment_row.status='captured' then
      update public.payment_attempts set status='succeeded',succeeded_at=coalesce(succeeded_at,now())
      where id=attempt_row.id;
      event_kind := 'payment.duplicate-success'; result_outcome := 'already_satisfied';
    else
      update public.payment_attempts set status='succeeded',succeeded_at=now() where id=attempt_row.id;
      update public.payments set status='captured',captured_at=now(),
        provider_payment_reference=target_provider_reference,reconciliation_required=false
      where id=payment_row.id;
      event_kind := 'payment.succeeded'; result_outcome := 'succeeded';
    end if;
  end if;
  insert into public.payment_events(
    organization_id,payment_id,event_type,provider_event_reference,idempotency_key,metadata
  ) values (
    payment_row.organization_id,payment_row.id,event_kind,target_provider_event_reference,
    'provider-event:'||target_provider_event_reference,
    jsonb_build_object('attemptId',attempt_row.id,'reservationId',reservation_row.id,'outcome',result_outcome)
  );
  insert into public.governance_audit_events(
    organization_id,event_type,actor_id,actor_type,resource_type,resource_id,
    action,outcome,correlation_id,request_id,idempotency_key,source_channel,metadata
  ) values (
    payment_row.organization_id,'runtime.operation',null,'system','payment',payment_row.id::text,
    event_kind,'success',target_provider_event_reference,target_provider_event_reference,
    'payment-provider:'||target_provider_event_reference,'provider',
    jsonb_build_object('attemptId',attempt_row.id,'reservationId',reservation_row.id)
  );
  if result_outcome in ('failed','succeeded') then
    insert into public.runtime_outbox_events(
      organization_id,event_type,aggregate_type,aggregate_id,payload,
      correlation_id,request_id,idempotency_key
    ) values (
      payment_row.organization_id,
      case when result_outcome='failed' then 'payment.failed.v1' else 'payment.succeeded.v1' end,
      'reservation',reservation_row.id::text,
      jsonb_build_object('tenantId',payment_row.organization_id,'reservationId',reservation_row.id,'paymentId',payment_row.id),
      target_provider_event_reference,target_provider_event_reference,'payment-outbox:'||target_provider_event_reference
    );
  end if;
  return jsonb_build_object(
    'outcome',result_outcome,'paymentId',payment_row.id,'reservationId',reservation_row.id
  );
end;
$$;

create trigger reservations_payment_requirement
before update of status on public.reservations
for each row execute function public.set_reservation_payment_requirement();

create or replace function public.enforce_reservation_ready_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'confirmed' and new.status = 'ready' and new.payment_required
     and not exists (
       select 1 from public.payments payment
       where payment.organization_id = new.organization_id
         and payment.reservation_id = new.id
         and payment.status = 'captured'
         and not payment.reconciliation_required
     ) then
    raise exception 'Verified payment is required before readiness';
  end if;
  return new;
end;
$$;

create trigger reservations_ready_payment_gate
before update of status on public.reservations
for each row execute function public.enforce_reservation_ready_payment();

create or replace function public.emit_payment_required_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status = 'confirmed' and new.payment_required then
    insert into public.runtime_outbox_events(
      organization_id,event_type,aggregate_type,aggregate_id,payload,
      correlation_id,request_id,idempotency_key
    ) values (
      new.organization_id,'payment.required.v1','reservation',new.id::text,
      jsonb_build_object('tenantId',new.organization_id,'reservationId',new.id),
      new.id::text,new.id::text,'payment-required:' || new.id::text
    ) on conflict (organization_id,idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger reservations_payment_required_event
after update of status on public.reservations
for each row execute function public.emit_payment_required_event();

create or replace function public.create_payment_attempt(
  target_organization_id uuid,target_actor_id uuid,target_reservation_id uuid,
  target_provider text,target_idempotency_key text,target_correlation_id text,
  target_request_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reservation_row public.reservations;
  payment_row public.payments;
  attempt_row public.payment_attempts;
  amount_value bigint;
  currency_value text;
  attempt_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch' using errcode = '42501';
  end if;
  if btrim(coalesce(target_provider,'')) = '' or btrim(coalesce(target_idempotency_key,'')) = '' then
    raise exception 'Payment attempt context is invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':' || target_reservation_id::text,0)
  );
  select * into reservation_row from public.reservations
  where id=target_reservation_id and organization_id=target_organization_id for update;
  if not found or reservation_row.patient_id is distinct from target_actor_id then
    raise exception 'Payment reservation is not accessible' using errcode = '42501';
  end if;
  if reservation_row.status <> 'confirmed' or not reservation_row.payment_required
     or reservation_row.expires_at <= now() then
    raise exception 'Reservation is not eligible for payment';
  end if;
  select batch.unit_price_minor * lock.quantity,batch.unit_price_currency_code
    into amount_value,currency_value
  from public.inventory_locks lock
  join public.inventory_batches batch on batch.id=lock.inventory_batch_id
    and batch.organization_id=lock.organization_id
  where lock.reservation_id=reservation_row.id
    and lock.organization_id=reservation_row.organization_id and lock.status='active';
  if amount_value is null or currency_value is null then
    raise exception 'Authoritative reservation price is unavailable';
  end if;
  select * into payment_row from public.payments
  where organization_id=target_organization_id and reservation_id=target_reservation_id
  order by created_at,id limit 1 for update;
  if found then
    if payment_row.amount_minor<>amount_value or payment_row.currency_code<>currency_value then
      raise exception 'Payment obligation does not match authoritative reservation price';
    end if;
    if payment_row.status='captured' then raise exception 'Payment obligation is already satisfied'; end if;
  else
    insert into public.payments(
      organization_id,reservation_id,patient_id,amount_minor,currency_code,status,
      payment_method_kind,provider,idempotency_key,correlation_id,created_by
    ) values (
      target_organization_id,target_reservation_id,target_actor_id,amount_value,currency_value,
      'pending','hosted',target_provider,'payment-obligation:'||target_reservation_id::text,
      target_correlation_id,target_actor_id
    ) returning * into payment_row;
  end if;
  select * into attempt_row from public.payment_attempts
  where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    if attempt_row.payment_id<>payment_row.id or attempt_row.amount_minor<>amount_value
       or attempt_row.currency_code<>currency_value then
      raise exception 'Payment attempt idempotency conflict';
    end if;
  else
    insert into public.payment_attempts(
      id,organization_id,payment_id,amount_minor,currency_code,provider,
      provider_reference,idempotency_key
    ) values (
      attempt_id,target_organization_id,payment_row.id,amount_value,currency_value,
      target_provider,'medlink-'||attempt_id::text,target_idempotency_key
    ) returning * into attempt_row;
    insert into public.payment_events(
      organization_id,payment_id,event_type,idempotency_key,actor_id,metadata
    ) values (
      target_organization_id,payment_row.id,'payment.attempt-created',
      target_idempotency_key||':event',target_actor_id,
      jsonb_build_object('attemptId',attempt_row.id,'reservationId',target_reservation_id)
    );
  end if;
  return jsonb_build_object(
    'paymentId',payment_row.id,'attemptId',attempt_row.id,
    'providerReference',attempt_row.provider_reference,'amountMinor',amount_value,
    'currency',currency_value,'paymentStatus',payment_row.status,'attemptStatus',attempt_row.status
  );
end;
$$;

revoke insert,update,delete on public.payments from authenticated;
revoke insert,update,delete on public.payment_events from authenticated;
revoke insert,update,delete on public.payment_attempts from authenticated;
grant select on public.payments,public.payment_events,public.payment_attempts to authenticated;
grant all on public.payment_attempts to service_role;
grant execute on function public.create_payment_attempt(uuid,uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.apply_payment_provider_event(text,text,text,bigint,text) to service_role;

comment on table public.payment_attempts is
  'Retryable provider attempts subordinate to one canonical reservation payment obligation.';
