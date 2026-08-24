-- Network transaction convergence: governed inventory freshness, reservation
-- revalidation, and auditable payment reconciliation. No source-type duration
-- is embedded here; every duration comes from an explicitly approved policy.

create type public.inventory_source_type as enum (
  'api', 'webhook', 'scheduled_sync', 'csv', 'xlsx', 'manual'
);

create table public.inventory_freshness_policies (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (btrim(reference) <> ''),
  source_type public.inventory_source_type not null,
  max_age_seconds integer not null check (max_age_seconds > 0),
  approved_by uuid not null references auth.users(id),
  approval_evidence text not null check (btrim(approval_evidence) <> ''),
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at)
);

create table public.inventory_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  pharmacy_location_id uuid not null,
  source_type public.inventory_source_type not null,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  policy_id uuid not null references public.inventory_freshness_policies(id),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (pharmacy_location_id, name),
  foreign key (pharmacy_location_id, organization_id)
    references public.pharmacy_locations(id, organization_id)
);

create table public.inventory_source_sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  inventory_source_id uuid not null,
  integration_health text not null check (integration_health in ('healthy','degraded','failed')),
  source_updated_at timestamptz not null,
  synchronized_at timestamptz not null,
  evidence_reference text not null check (btrim(evidence_reference) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (inventory_source_id, organization_id)
    references public.inventory_sources(id, organization_id),
  check (synchronized_at >= source_updated_at)
);

create index inventory_source_sync_latest_idx
  on public.inventory_source_sync_events(inventory_source_id, synchronized_at desc, id desc);

alter table public.inventory_batches
  add column inventory_source_id uuid,
  add column source_updated_at timestamptz,
  add foreign key (inventory_source_id, organization_id)
    references public.inventory_sources(id, organization_id),
  add constraint inventory_batch_source_timestamp_pair check (
    (inventory_source_id is null) = (source_updated_at is null)
  );

create or replace function public.prevent_inventory_policy_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Inventory freshness policy and sync evidence are append-only';
end;
$$;

create trigger inventory_freshness_policies_append_only
before update or delete on public.inventory_freshness_policies
for each row execute function public.prevent_inventory_policy_mutation();
create trigger inventory_source_sync_events_append_only
before update or delete on public.inventory_source_sync_events
for each row execute function public.prevent_inventory_policy_mutation();

create or replace function public.guard_inventory_batch_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.inventory_source_id is not null
     and (new.inventory_source_id is distinct from old.inventory_source_id
       or new.source_updated_at < old.source_updated_at) then
    raise exception 'Inventory source identity and freshness evidence cannot be rewritten';
  end if;
  return new;
end;
$$;
create trigger inventory_batch_source_guard
before update on public.inventory_batches
for each row execute function public.guard_inventory_batch_source();

create or replace function public.create_inventory_source(
  target_organization_id uuid, target_location_id uuid,
  target_source_type public.inventory_source_type, target_name text,
  target_policy_reference text
) returns public.inventory_sources language plpgsql security definer set search_path = '' as $$
declare source public.inventory_sources; policy public.inventory_freshness_policies;
begin
  if auth.uid() is null or not public.has_organization_role(
    target_organization_id,
    array['platform_admin','tenant_admin','pharmacy_owner','inventory_manager']::public.member_role[]
  ) then raise exception 'Inventory source administration is not authorized' using errcode='42501'; end if;
  select * into policy from public.inventory_freshness_policies
  where reference=target_policy_reference and source_type=target_source_type
    and effective_at<=now() and (expires_at is null or expires_at>now());
  if not found then raise exception 'An active source-specific freshness policy is required'; end if;
  if not exists(select 1 from public.pharmacy_locations
    where id=target_location_id and organization_id=target_organization_id
      and is_active and deleted_at is null) then
    raise exception 'Active pharmacy location was not found';
  end if;
  insert into public.inventory_sources(
    organization_id,pharmacy_location_id,source_type,name,policy_id,created_by
  ) values(target_organization_id,target_location_id,target_source_type,btrim(target_name),policy.id,auth.uid())
  returning * into source;
  return source;
end;
$$;

create or replace function public.record_inventory_source_sync(
  target_organization_id uuid,target_source_id uuid,target_integration_health text,
  target_source_updated_at timestamptz,target_synchronized_at timestamptz,
  target_evidence_reference text,target_idempotency_key text
) returns public.inventory_source_sync_events language plpgsql security definer set search_path = '' as $$
declare event public.inventory_source_sync_events; source public.inventory_sources;
begin
  if auth.uid() is null or not public.has_organization_role(
    target_organization_id,
    array['platform_admin','tenant_admin','pharmacy_owner','inventory_manager']::public.member_role[]
  ) then raise exception 'Inventory synchronization evidence is not authorized' using errcode='42501'; end if;
  select * into source from public.inventory_sources
  where id=target_source_id and organization_id=target_organization_id and active;
  if not found then raise exception 'Active inventory source was not found'; end if;
  select * into event from public.inventory_source_sync_events
  where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    if event.inventory_source_id<>target_source_id
      or event.integration_health<>target_integration_health
      or event.source_updated_at<>target_source_updated_at
      or event.synchronized_at<>target_synchronized_at then
      raise exception 'Inventory synchronization idempotency conflict';
    end if;
    return event;
  end if;
  insert into public.inventory_source_sync_events(
    organization_id,inventory_source_id,integration_health,source_updated_at,
    synchronized_at,evidence_reference,idempotency_key,recorded_by
  ) values(target_organization_id,target_source_id,target_integration_health,
    target_source_updated_at,target_synchronized_at,target_evidence_reference,
    target_idempotency_key,auth.uid()) returning * into event;
  return event;
end;
$$;

create or replace function public.attach_inventory_batch_source(
  target_organization_id uuid,target_inventory_id uuid,target_source_id uuid,
  target_source_updated_at timestamptz
) returns public.inventory_batches language plpgsql security definer set search_path = '' as $$
declare batch public.inventory_batches; source public.inventory_sources;
begin
  if auth.uid() is null or not public.has_organization_role(
    target_organization_id,
    array['platform_admin','tenant_admin','pharmacy_owner','inventory_manager']::public.member_role[]
  ) then raise exception 'Inventory source attachment is not authorized' using errcode='42501'; end if;
  select * into batch from public.inventory_batches
    where id=target_inventory_id and organization_id=target_organization_id for update;
  select * into source from public.inventory_sources
    where id=target_source_id and organization_id=target_organization_id and active;
  if batch.id is null or source.id is null
    or source.pharmacy_location_id<>batch.pharmacy_location_id then
    raise exception 'Inventory source does not govern this batch';
  end if;
  update public.inventory_batches set inventory_source_id=target_source_id,
    source_updated_at=target_source_updated_at
  where id=target_inventory_id and organization_id=target_organization_id
  returning * into batch;
  return batch;
end;
$$;

create or replace function public.inventory_source_fresh(target_source_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.inventory_sources source
    join public.inventory_freshness_policies policy on policy.id=source.policy_id
    join lateral (
      select sync.* from public.inventory_source_sync_events sync
      where sync.inventory_source_id=source.id
      order by sync.synchronized_at desc,sync.id desc limit 1
    ) latest on true
    where source.id=target_source_id and source.active
      and policy.source_type=source.source_type
      and policy.effective_at<=now() and (policy.expires_at is null or policy.expires_at>now())
      and latest.integration_health='healthy'
      and latest.synchronized_at>=latest.source_updated_at
      and now()<latest.source_updated_at + make_interval(secs=>policy.max_age_seconds)
  )
$$;

-- Partner location readiness now proves that an actual governed source is
-- fresh. Capability evidence alone cannot manufacture network participation.
create or replace function public.partner_location_network_state(target_location_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with state as (
    select a.id application_id,a.relationship_status,l.id location_id,l.is_active,
      l.deleted_at,l.license_number,e.credential_status,e.inventory_integration_status,
      e.inventory_freshness_status,e.medication_mapping_status,e.payment_capability_status,
      e.fulfillment_capability_status,e.freshness_policy_reference,
      exists(select 1 from public.inventory_sources source
        where source.pharmacy_location_id=l.id and source.active) has_source,
      exists(select 1 from public.inventory_sources source
        where source.pharmacy_location_id=l.id and source.active
          and public.inventory_source_fresh(source.id)) has_fresh_source
    from public.pharmacy_locations l
    left join lateral (
      select candidate.* from public.partner_applications candidate
      where candidate.organization_id=l.organization_id and candidate.deleted_at is null
      order by candidate.created_at desc limit 1
    ) a on true
    left join public.partner_location_capability_evidence e
      on e.application_id=a.id and e.pharmacy_location_id=l.id
    where l.id=target_location_id limit 1
  ), blockers as (
    select array_remove(array[
      case when application_id is not null and relationship_status<>'active' then 'partner_not_active' end,
      case when not is_active or deleted_at is not null then 'location_not_active' end,
      case when license_number is null then 'location_credential_missing' end,
      case when application_id is not null and credential_status is distinct from 'verified' then 'location_credential_unverified' end,
      case when application_id is not null and inventory_integration_status is distinct from 'healthy' then 'inventory_integration_unhealthy' end,
      case when application_id is not null and inventory_freshness_status is distinct from 'current' then 'inventory_not_current' end,
      case when application_id is not null and freshness_policy_reference is null then 'inventory_freshness_policy_required' end,
      case when application_id is not null and not has_source then 'inventory_source_missing' end,
      case when application_id is not null and has_source and not has_fresh_source then 'inventory_source_stale' end,
      case when application_id is not null and medication_mapping_status is distinct from 'eligible' then 'medication_mapping_ineligible' end,
      case when application_id is not null and payment_capability_status is distinct from 'ready' then 'payment_capability_not_ready' end,
      case when application_id is not null and fulfillment_capability_status is distinct from 'ready' then 'fulfillment_capability_not_ready' end
    ],null)::text[] value from state
  )
  select case when not exists(select 1 from state)
    then jsonb_build_object('networkReady',false,'legacyNetwork',false,'blockers',jsonb_build_array('location_not_found'))
    when (select application_id is null from state)
    then jsonb_build_object('networkReady',(select is_active and deleted_at is null from state),'legacyNetwork',true,
      'blockers',case when (select is_active and deleted_at is null from state) then '[]'::jsonb else jsonb_build_array('location_not_active') end)
    else jsonb_build_object('networkReady',cardinality((select value from blockers))=0,
      'legacyNetwork',false,'blockers',to_jsonb((select value from blockers))) end
$$;

create or replace function public.is_inventory_batch_discoverable(target_inventory_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.inventory_batches batch
    join public.pharmacy_locations location on location.id=batch.pharmacy_location_id
      and location.organization_id=batch.organization_id
    where batch.id=target_inventory_id and batch.deleted_at is null
      and batch.status='available' and batch.expires_on>=current_date
      and batch.available_quantity>0 and location.is_active and location.deleted_at is null
      and public.is_location_network_eligible(location.id)
      and (
        not exists(select 1 from public.partner_applications application
          where application.organization_id=batch.organization_id and application.deleted_at is null)
        or (batch.inventory_source_id is not null
          and public.inventory_source_fresh(batch.inventory_source_id)
          and batch.source_updated_at is not null
          and exists(select 1 from public.inventory_source_sync_events sync
            where sync.inventory_source_id=batch.inventory_source_id
              and sync.source_updated_at>=batch.source_updated_at))
      )
  )
$$;

create or replace function public.search_inventory_availability(
  target_organization_id uuid,target_medicine_id uuid default null,
  target_pharmacy_location_id uuid default null,target_quantity integer default 1
) returns table(
  inventory_id uuid,pharmacy_location_id uuid,pharmacy_name text,medicine_id uuid,
  brand_name text,generic_name text,strength text,batch_number text,expires_on date,
  available_quantity integer,unit text,unit_price_minor bigint,currency_code text,
  availability_state text
) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or target_organization_id is null
    or not public.is_organization_member(target_organization_id)
    or target_quantity is null or target_quantity<1 or target_quantity>1000000
  then raise exception 'invalid inventory availability context' using errcode='22023'; end if;
  return query select batch.id,location.id,location.name,medicine.id,medicine.brand_name,
    medicine.generic_name,medicine.strength_display,batch.batch_number,batch.expires_on,
    batch.available_quantity,batch.unit,batch.unit_price_minor,batch.unit_price_currency_code,
    public.inventory_availability_state(batch.status,batch.expires_on,batch.available_quantity,
      batch.quantity_reserved,batch.low_stock_threshold,location.is_active)
  from public.inventory_batches batch
  join public.pharmacy_locations location on location.id=batch.pharmacy_location_id
    and location.organization_id=batch.organization_id
  join public.medicines medicine on medicine.id=batch.medicine_id
  where batch.organization_id=target_organization_id
    and (target_medicine_id is null or batch.medicine_id=target_medicine_id)
    and (target_pharmacy_location_id is null or batch.pharmacy_location_id=target_pharmacy_location_id)
    and batch.available_quantity>=target_quantity
    and medicine.status='active' and medicine.deleted_at is null
    and public.is_inventory_batch_discoverable(batch.id)
  order by medicine.id,batch.expires_on,batch.available_quantity desc,batch.id;
end $$;

create or replace function public.enforce_new_reservation_network_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='active' and not public.is_inventory_batch_discoverable(new.inventory_batch_id) then
    raise exception 'Inventory is not eligible for a new network reservation';
  end if;
  return new;
end;
$$;
create trigger inventory_lock_network_eligibility
before insert on public.inventory_locks
for each row execute function public.enforce_new_reservation_network_eligibility();

-- Patient reads retain stale rows for authorized operational/audit users, but
-- the patient discovery policy excludes them from new discovery.
drop policy if exists inventory_batches_patient_discovery on public.inventory_batches;
create policy inventory_batches_patient_discovery
  on public.inventory_batches for select to authenticated
  using (
    public.has_organization_role(organization_id,array['patient']::public.member_role[])
    and public.is_inventory_batch_discoverable(id)
  );

alter table public.inventory_freshness_policies enable row level security;
alter table public.inventory_sources enable row level security;
alter table public.inventory_source_sync_events enable row level security;
create policy inventory_freshness_policy_read on public.inventory_freshness_policies
  for select to authenticated using (true);
create policy inventory_sources_tenant_read on public.inventory_sources
  for select to authenticated using (public.is_organization_member(organization_id));
create policy inventory_source_sync_tenant_read on public.inventory_source_sync_events
  for select to authenticated using (public.is_organization_member(organization_id));
revoke insert,update,delete on public.inventory_freshness_policies,public.inventory_sources,
  public.inventory_source_sync_events from authenticated;
grant select on public.inventory_freshness_policies,public.inventory_sources,
  public.inventory_source_sync_events to authenticated;
grant execute on function public.create_inventory_source(uuid,uuid,public.inventory_source_type,text,text) to authenticated;
grant execute on function public.record_inventory_source_sync(uuid,uuid,text,timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.attach_inventory_batch_source(uuid,uuid,uuid,timestamptz) to authenticated;
revoke all on function public.inventory_source_fresh(uuid),public.is_inventory_batch_discoverable(uuid) from public;
grant execute on function public.inventory_source_fresh(uuid),public.is_inventory_batch_discoverable(uuid) to authenticated,service_role;

create type public.payment_reconciliation_status as enum ('open','resolved');
create table public.payment_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  payment_id uuid,
  provider_event_reference text not null,
  provider_payment_reference text not null,
  reason text not null check (reason in (
    'internal_pending_provider_paid','internal_paid_provider_unconfirmed',
    'duplicate_provider_transaction','orphan_provider_transaction',
    'late_success','late_failure','late_success_after_reservation_expiry',
    'amount_or_currency_mismatch'
  )),
  provider_evidence jsonb not null,
  status public.payment_reconciliation_status not null default 'open',
  resolution text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider_event_reference),
  foreign key(payment_id,organization_id) references public.payments(id,organization_id),
  check ((status='open' and resolution is null and resolved_by is null and resolved_at is null)
    or (status='resolved' and resolution is not null and resolved_by is not null and resolved_at is not null))
);

create or replace function public.capture_payment_reconciliation_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payment public.payments; reservation public.reservations; attempt public.payment_attempts;
  case_reason text;
begin
  select * into payment from public.payments
    where id=new.payment_id and organization_id=new.organization_id;
  select * into reservation from public.reservations
    where id=payment.reservation_id and organization_id=payment.organization_id;
  if new.metadata ? 'attemptId' then
    select * into attempt from public.payment_attempts
      where id=(new.metadata->>'attemptId')::uuid and organization_id=new.organization_id;
  end if;
  case_reason := case
    when new.event_type='payment.late-success-reconciliation'
      and reservation.expires_at<=new.occurred_at then 'late_success_after_reservation_expiry'
    when new.event_type='payment.late-success-reconciliation' then 'late_success'
    when new.event_type='payment.duplicate-success' then 'duplicate_provider_transaction'
    when new.event_type='payment.provider-rejected' then 'amount_or_currency_mismatch'
    when new.event_type='payment.failed' and payment.status in ('authorized','captured') then 'late_failure'
    else null end;
  if case_reason is not null then
    insert into public.payment_reconciliation_cases(
      organization_id,payment_id,provider_event_reference,provider_payment_reference,
      reason,provider_evidence
    ) values(new.organization_id,new.payment_id,new.provider_event_reference,
      coalesce(attempt.provider_reference,payment.provider_payment_reference,'unresolved'),
      case_reason,jsonb_build_object('eventType',new.event_type,'metadata',new.metadata,
        'occurredAt',new.occurred_at)) on conflict(provider_event_reference) do nothing;
    update public.payments set reconciliation_required=true where id=new.payment_id;
  end if;
  return new;
end;
$$;
create trigger payment_events_reconciliation_capture
after insert on public.payment_events
for each row execute function public.capture_payment_reconciliation_event();

create or replace function public.open_payment_reconciliation_case(
  target_organization_id uuid,target_payment_id uuid,target_provider_event_reference text,
  target_provider_payment_reference text,target_reason text,target_provider_evidence jsonb
) returns public.payment_reconciliation_cases language plpgsql security definer set search_path = '' as $$
declare existing public.payment_reconciliation_cases;
begin
  if auth.role()<>'service_role' then raise exception 'Verified provider authority is required' using errcode='42501'; end if;
  select * into existing from public.payment_reconciliation_cases
    where provider_event_reference=target_provider_event_reference;
  if found then return existing; end if;
  insert into public.payment_reconciliation_cases(
    organization_id,payment_id,provider_event_reference,provider_payment_reference,reason,provider_evidence
  ) values(target_organization_id,target_payment_id,target_provider_event_reference,
    target_provider_payment_reference,target_reason,target_provider_evidence)
  returning * into existing;
  if target_payment_id is not null then
    update public.payments set reconciliation_required=true where id=target_payment_id;
  end if;
  return existing;
end;
$$;

create or replace function public.resolve_payment_reconciliation_case(
  target_case_id uuid,target_resolution text,target_evidence_reference text
) returns public.payment_reconciliation_cases language plpgsql security definer set search_path = '' as $$
declare current public.payment_reconciliation_cases;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required' using errcode='42501'; end if;
  if btrim(coalesce(target_resolution,''))='' or btrim(coalesce(target_evidence_reference,''))='' then
    raise exception 'Evidence-backed reconciliation resolution is required';
  end if;
  select * into current from public.payment_reconciliation_cases where id=target_case_id for update;
  if not found then raise exception 'Payment reconciliation case not found'; end if;
  if current.status='resolved' then return current; end if;
  update public.payment_reconciliation_cases set status='resolved',
    resolution=target_resolution||' | evidence='||target_evidence_reference,
    resolved_by=auth.uid(),resolved_at=now() where id=target_case_id returning * into current;
  insert into public.governance_audit_events(
    organization_id,event_type,actor_id,actor_type,resource_type,resource_id,
    action,outcome,correlation_id,request_id,idempotency_key,source_channel,metadata
  ) values(current.organization_id,'payment.reconciliation',auth.uid(),'user',
    'payment_reconciliation_case',current.id::text,'payment.reconciliation.resolve','success',
    current.provider_event_reference,current.provider_event_reference,
    'payment-reconciliation:'||current.id::text,'admin',
    jsonb_build_object('paymentId',current.payment_id,'reason',current.reason,
      'evidenceReference',target_evidence_reference));
  if current.payment_id is not null and not exists(
    select 1 from public.payment_reconciliation_cases pending
    where pending.payment_id=current.payment_id and pending.status='open'
  ) then
    update public.payments set reconciliation_required=false where id=current.payment_id;
  end if;
  return current;
end;
$$;

alter table public.payment_reconciliation_cases enable row level security;
create policy payment_reconciliation_admin_read on public.payment_reconciliation_cases
  for select to authenticated using (public.is_platform_admin());
revoke insert,update,delete on public.payment_reconciliation_cases from authenticated;
grant select on public.payment_reconciliation_cases to authenticated,service_role;
grant insert,update on public.payment_reconciliation_cases to service_role;
grant execute on function public.open_payment_reconciliation_case(uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.resolve_payment_reconciliation_case(uuid,text,text) to authenticated;

comment on table public.inventory_freshness_policies is
  'Owner-approved source-specific freshness durations. No universal duration is supplied by MedLink.';
comment on table public.inventory_source_sync_events is
  'Append-only source health and synchronization evidence; stale evidence remains auditable.';
comment on table public.payment_reconciliation_cases is
  'Explicit provider/domain disagreements. Provider evidence is retained; no case silently manufactures financial truth.';
