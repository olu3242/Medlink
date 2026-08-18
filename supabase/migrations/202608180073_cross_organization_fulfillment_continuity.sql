-- Preserve authoritative price and pharmacy fulfillment across the explicit
-- patient-organization/pharmacy-organization reservation boundary.

create or replace function public.set_reservation_payment_requirement()
returns trigger language plpgsql security definer set search_path='' as $$
declare priced boolean;
begin
  if old.status='pending' and new.status='confirmed' then
    select batch.unit_price_minor is not null and batch.unit_price_currency_code is not null
      into priced
    from public.inventory_locks lock
    join public.inventory_batches batch on batch.id=lock.inventory_batch_id
      and batch.organization_id=lock.inventory_organization_id
    where lock.reservation_id=new.id and lock.organization_id=new.organization_id
      and lock.status='active';
    new.payment_required:=coalesce(priced,false);
  end if;
  return new;
end;
$$;

create or replace function public.create_payment_attempt(
  target_organization_id uuid,target_actor_id uuid,target_reservation_id uuid,
  target_provider text,target_idempotency_key text,target_correlation_id text,
  target_request_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reservation_row public.reservations; payment_row public.payments;
  attempt_row public.payment_attempts; amount_value bigint; currency_value text;
  attempt_id uuid:=gen_random_uuid();
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch' using errcode='42501'; end if;
  if btrim(coalesce(target_provider,''))='' or btrim(coalesce(target_idempotency_key,''))='' then
    raise exception 'Payment attempt context is invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text||':'||target_reservation_id::text,0));
  select * into reservation_row from public.reservations
    where id=target_reservation_id and organization_id=target_organization_id for update;
  if not found or reservation_row.patient_id is distinct from target_actor_id then
    raise exception 'Payment reservation is not accessible' using errcode='42501'; end if;
  if reservation_row.status<>'confirmed' or not reservation_row.payment_required
     or reservation_row.expires_at<=now() then raise exception 'Reservation is not eligible for payment'; end if;
  select batch.unit_price_minor*lock.quantity,batch.unit_price_currency_code
    into amount_value,currency_value
  from public.inventory_locks lock
  join public.inventory_batches batch on batch.id=lock.inventory_batch_id
    and batch.organization_id=lock.inventory_organization_id
  where lock.reservation_id=reservation_row.id and lock.organization_id=reservation_row.organization_id
    and lock.status='active';
  if amount_value is null or currency_value is null then raise exception 'Authoritative reservation price is unavailable'; end if;
  select * into payment_row from public.payments
    where organization_id=target_organization_id and reservation_id=target_reservation_id
    order by created_at,id limit 1 for update;
  if found then
    if payment_row.amount_minor<>amount_value or payment_row.currency_code<>currency_value then
      raise exception 'Payment obligation does not match authoritative reservation price'; end if;
    if payment_row.status='captured' then raise exception 'Payment obligation is already satisfied'; end if;
  else
    insert into public.payments(
      organization_id,reservation_id,patient_id,amount_minor,currency_code,status,
      payment_method_kind,provider,idempotency_key,correlation_id,created_by
    ) values(target_organization_id,target_reservation_id,target_actor_id,amount_value,
      currency_value,'pending','hosted',target_provider,
      'payment-obligation:'||target_reservation_id::text,target_correlation_id,target_actor_id)
    returning * into payment_row;
  end if;
  select * into attempt_row from public.payment_attempts
    where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    if attempt_row.payment_id<>payment_row.id or attempt_row.amount_minor<>amount_value
       or attempt_row.currency_code<>currency_value then raise exception 'Payment attempt idempotency conflict'; end if;
  else
    insert into public.payment_attempts(
      id,organization_id,payment_id,amount_minor,currency_code,provider,
      provider_reference,idempotency_key
    ) values(attempt_id,target_organization_id,payment_row.id,amount_value,currency_value,
      target_provider,'medlink-'||attempt_id::text,target_idempotency_key)
    returning * into attempt_row;
    insert into public.payment_events(
      organization_id,payment_id,event_type,idempotency_key,actor_id,metadata
    ) values(target_organization_id,payment_row.id,'payment.attempt-created',
      target_idempotency_key||':event',target_actor_id,
      jsonb_build_object('attemptId',attempt_row.id,'reservationId',target_reservation_id));
  end if;
  return jsonb_build_object('paymentId',payment_row.id,'attemptId',attempt_row.id,
    'providerReference',attempt_row.provider_reference,'amountMinor',amount_value,
    'currency',currency_value,'paymentStatus',payment_row.status,'attemptStatus',attempt_row.status);
end;
$$;

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
using (
  patient_id=auth.uid()
  or exists(
    select 1 from public.reservations reservation
    where reservation.id=reservation_id
      and reservation.organization_id=organization_id
      and public.has_organization_role(
        reservation.pharmacy_organization_id,
        array['platform_admin','tenant_admin','pharmacy_owner','pharmacy_staff']::public.member_role[]
      )
  )
);

create or replace function public.decide_reservation(
  target_organization_id uuid,target_actor_id uuid,target_correlation_id text,
  target_request_id text,target_idempotency_key text,target_channel text,
  target_reservation_id uuid,target_status text,target_reason text default null
)
returns public.reservations language plpgsql security definer set search_path='' as $$
declare current_reservation public.reservations; prior_transition public.fulfillment_transitions;
  event_name text; normalized_reason text;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid()
     or not public.has_organization_role(target_organization_id,
       array['pharmacist','pharmacy_staff']::public.member_role[]) then
    raise exception 'Reservation decision requires pharmacy staff or pharmacist role'; end if;
  if target_status not in ('confirmed','cancelled') then raise exception 'Reservation decision status is invalid'; end if;
  normalized_reason:=nullif(btrim(coalesce(target_reason,'')),'');
  if target_status='cancelled' and (normalized_reason is null or char_length(normalized_reason)<3) then
    raise exception 'A meaningful reason is required to cancel a reservation'; end if;
  event_name:=case when target_status='confirmed' then 'reservation.confirmed.v1' else 'reservation.cancelled.v1' end;
  select * into prior_transition from public.fulfillment_transitions
    where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    if prior_transition.reservation_id<>target_reservation_id or prior_transition.to_state<>target_status then
      raise exception 'Idempotency key was already used for a different reservation decision'; end if;
    select * into current_reservation from public.reservations
      where id=target_reservation_id and pharmacy_organization_id=target_organization_id;
    return current_reservation;
  end if;
  select * into current_reservation from public.reservations
    where id=target_reservation_id and pharmacy_organization_id=target_organization_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status<>'pending' then raise exception 'Only a pending reservation may receive a pharmacy decision'; end if;
  update public.reservations set status=target_status::public.reservation_status,
    confirmed_at=case when target_status='confirmed' then now() else confirmed_at end,
    cancelled_at=case when target_status='cancelled' then now() else cancelled_at end
  where id=target_reservation_id and pharmacy_organization_id=target_organization_id
  returning * into current_reservation;
  if target_status='cancelled' then
    update public.inventory_locks set status='released',released_at=now()
      where reservation_id=target_reservation_id
        and organization_id=current_reservation.organization_id and status='active';
  end if;
  insert into public.fulfillment_transitions(
    organization_id,reservation_id,from_state,to_state,step,idempotency_key,correlation_id,reason
  ) values(target_organization_id,target_reservation_id,'pending',target_status,
    'pharmacy.'||target_status,target_idempotency_key,target_correlation_id::uuid,normalized_reason);
  perform public.record_runtime_evidence(target_organization_id,target_actor_id,
    'reservations.decide','success',target_correlation_id,target_request_id,target_idempotency_key,
    'reservation',target_reservation_id::text,jsonb_build_object('status','pending'),
    jsonb_build_object('status',target_status)||case when normalized_reason is null then '{}'::jsonb
      else jsonb_build_object('reason',normalized_reason) end,null,null,target_channel,event_name,
    jsonb_build_object('tenantId',target_organization_id,'reservationId',target_reservation_id));
  return current_reservation;
end;
$$;

create or replace function public.mark_reservation_ready(
  target_organization_id uuid,target_actor_id uuid,target_correlation_id text,
  target_request_id text,target_idempotency_key text,target_channel text,target_reservation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_reservation public.reservations; prior_transition public.fulfillment_transitions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid()
     or not public.has_organization_role(target_organization_id,
       array['pharmacist','pharmacy_staff']::public.member_role[]) then
    raise exception 'Marking a reservation ready requires pharmacy staff or pharmacist role'; end if;
  select * into prior_transition from public.fulfillment_transitions
    where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    if prior_transition.reservation_id<>target_reservation_id or prior_transition.to_state<>'ready' then
      raise exception 'Idempotency key was already used for a different reservation decision'; end if;
    select * into current_reservation from public.reservations
      where id=target_reservation_id and pharmacy_organization_id=target_organization_id;
    return to_jsonb(current_reservation)-'pickup_code_hash';
  end if;
  select * into current_reservation from public.reservations
    where id=target_reservation_id and pharmacy_organization_id=target_organization_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status<>'confirmed' then raise exception 'Only a confirmed reservation may be marked ready'; end if;
  update public.reservations set status='ready'
    where id=target_reservation_id and pharmacy_organization_id=target_organization_id
    returning * into current_reservation;
  insert into public.fulfillment_transitions(
    organization_id,reservation_id,from_state,to_state,step,idempotency_key,correlation_id
  ) values(target_organization_id,target_reservation_id,'confirmed','ready','pharmacy.ready',
    target_idempotency_key,target_correlation_id::uuid);
  perform public.record_runtime_evidence(target_organization_id,target_actor_id,
    'reservations.ready','success',target_correlation_id,target_request_id,target_idempotency_key,
    'reservation',target_reservation_id::text,jsonb_build_object('status','confirmed'),
    jsonb_build_object('status','ready'),null,null,target_channel,'reservation.ready.v1',
    jsonb_build_object('tenantId',target_organization_id,'reservationId',target_reservation_id));
  return to_jsonb(current_reservation)-'pickup_code_hash';
end;
$$;

create or replace function public.collect_reservation(
  target_organization_id uuid,target_actor_id uuid,target_correlation_id text,
  target_request_id text,target_idempotency_key text,target_channel text,
  target_reservation_id uuid,target_pickup_code_hash text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_reservation public.reservations; prior_transition public.fulfillment_transitions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid()
     or not public.has_organization_role(target_organization_id,
       array['pharmacist','pharmacy_staff']::public.member_role[]) then
    raise exception 'Collecting a reservation requires pharmacy staff or pharmacist role'; end if;
  if target_pickup_code_hash is null or char_length(target_pickup_code_hash)<>64 then
    raise exception 'A pickup credential is required'; end if;
  select * into prior_transition from public.fulfillment_transitions
    where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    if prior_transition.reservation_id<>target_reservation_id or prior_transition.to_state<>'collected' then
      raise exception 'Idempotency key was already used for a different reservation decision'; end if;
    select * into current_reservation from public.reservations
      where id=target_reservation_id and pharmacy_organization_id=target_organization_id;
    return to_jsonb(current_reservation)-'pickup_code_hash';
  end if;
  select * into current_reservation from public.reservations
    where id=target_reservation_id and pharmacy_organization_id=target_organization_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status<>'ready' then raise exception 'Only a reservation marked ready may be collected'; end if;
  if current_reservation.pickup_code_hash is distinct from target_pickup_code_hash then
    raise exception 'Pickup credential is invalid'; end if;
  update public.reservations set status='collected',collected_at=now(),pickup_code_hash=null
    where id=target_reservation_id and pharmacy_organization_id=target_organization_id
    returning * into current_reservation;
  update public.inventory_locks set status='consumed',consumed_at=now()
    where reservation_id=target_reservation_id
      and organization_id=current_reservation.organization_id and status='active';
  insert into public.fulfillment_transitions(
    organization_id,reservation_id,from_state,to_state,step,idempotency_key,correlation_id
  ) values(target_organization_id,target_reservation_id,'ready','collected','pharmacy.collected',
    target_idempotency_key,target_correlation_id::uuid);
  perform public.record_runtime_evidence(target_organization_id,target_actor_id,
    'reservations.collect','success',target_correlation_id,target_request_id,target_idempotency_key,
    'reservation',target_reservation_id::text,jsonb_build_object('status','ready'),
    jsonb_build_object('status','collected'),null,null,target_channel,'reservation.collected.v1',
    jsonb_build_object('tenantId',target_organization_id,'reservationId',target_reservation_id));
  return to_jsonb(current_reservation)-'pickup_code_hash';
end;
$$;

create or replace function public.continue_medication_access_after_collection()
returns trigger language plpgsql security definer set search_path='' as $$
declare reservation_row public.reservations; current_state public.mar_status;
begin
  if new.to_state<>'collected' then return new; end if;
  select * into reservation_row from public.reservations where id=new.reservation_id;
  if not found then raise exception 'Collected reservation has no medication access workflow'; end if;
  select request.state into current_state from public.medication_access_requests request
    where request.id=reservation_row.mar_id
      and request.organization_id=reservation_row.organization_id for update;
  if current_state in ('reserved','paid') then
    update public.medication_access_requests set state='dispensed',
      transition_idempotency_key=new.idempotency_key||':mar-dispensed'
      where id=reservation_row.mar_id and organization_id=reservation_row.organization_id;
    current_state:='dispensed';
  end if;
  if current_state='dispensed' then
    update public.medication_access_requests set state='completed',completed_at=now(),
      transition_idempotency_key=new.idempotency_key||':mar-completed'
      where id=reservation_row.mar_id and organization_id=reservation_row.organization_id;
    current_state:='completed';
  end if;
  if current_state<>'completed' then
    raise exception 'Collected reservation cannot complete MAR in state %',current_state; end if;
  insert into public.runtime_outbox_events(
    organization_id,event_type,aggregate_type,aggregate_id,payload,
    correlation_id,request_id,workflow_id,idempotency_key
  ) values(
    reservation_row.organization_id,'medication_access.completed.v1',
    'medication_access_request',reservation_row.mar_id::text,
    jsonb_build_object('marId',reservation_row.mar_id,'reservationId',new.reservation_id,
      'workflowId',reservation_row.mar_id,'pharmacyOrganizationId',new.organization_id),
    new.correlation_id::text,new.idempotency_key,reservation_row.mar_id::text,
    new.idempotency_key||':medication-access-completed:event'
  ) on conflict(organization_id,idempotency_key) do nothing;
  insert into public.governance_audit_events(
    organization_id,event_type,actor_id,actor_type,resource_type,resource_id,
    action,outcome,correlation_id,request_id,idempotency_key,previous_state,
    new_state,workflow_id,source_channel,metadata
  ) values(
    reservation_row.organization_id,'runtime.operation',auth.uid(),'user',
    'medication_access_request',reservation_row.mar_id::text,
    'medication_access.complete','success',new.correlation_id::text,new.idempotency_key,
    new.idempotency_key||':medication-access-completed:audit',
    jsonb_build_object('state','dispensed'),jsonb_build_object('state','completed'),
    reservation_row.mar_id::text,'pharmacy_portal',
    jsonb_build_object('reservationId',new.reservation_id,
      'pharmacyOrganizationId',new.organization_id)
  ) on conflict(organization_id,idempotency_key) do nothing;
  return new;
end;
$$;

comment on column public.reservations.organization_id is
  'Patient security context and payment obligation organization.';
comment on column public.reservations.pharmacy_organization_id is
  'Pharmacy authority responsible for location, inventory, and fulfillment.';
comment on column public.inventory_locks.inventory_organization_id is
  'Inventory tenant authority; organization_id remains the patient reservation authority.';
