-- Location-level Partner Network readiness is derived from independent
-- authorities. There is intentionally no writable network_ready boolean.

create table public.partner_location_capability_evidence (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  pharmacy_location_id uuid not null,
  credential_status public.partner_verification_status not null default 'pending',
  inventory_integration_status text not null default 'unknown' check (inventory_integration_status in ('unknown','healthy','degraded','failed')),
  inventory_freshness_status text not null default 'unknown' check (inventory_freshness_status in ('unknown','current','stale','source_unavailable')),
  medication_mapping_status text not null default 'unknown' check (medication_mapping_status in ('unknown','eligible','blocked','ambiguous')),
  payment_capability_status text not null default 'unknown' check (payment_capability_status in ('unknown','ready','degraded','failed')),
  fulfillment_capability_status text not null default 'unknown' check (fulfillment_capability_status in ('unknown','ready','degraded','failed')),
  freshness_policy_reference text,
  source_updated_at timestamptz,
  last_successful_sync timestamptz,
  evidence_reference text not null,
  evidence_digest text check (evidence_digest is null or evidence_digest ~ '^[A-Fa-f0-9]{64}$'),
  verified_by uuid not null references auth.users(id),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(application_id, pharmacy_location_id),
  foreign key(pharmacy_location_id,organization_id) references public.pharmacy_locations(id,organization_id),
  check (inventory_freshness_status <> 'current' or (source_updated_at is not null and last_successful_sync is not null and freshness_policy_reference is not null)),
  check (last_successful_sync is null or source_updated_at is null or last_successful_sync >= source_updated_at)
);
create trigger partner_location_evidence_updated before update on public.partner_location_capability_evidence for each row execute function public.set_updated_at();

create or replace function public.record_partner_location_capability(
  target_application_id uuid,target_location_id uuid,
  target_credential_status public.partner_verification_status,
  target_inventory_integration_status text,target_inventory_freshness_status text,
  target_medication_mapping_status text,target_payment_capability_status text,
  target_fulfillment_capability_status text,target_freshness_policy_reference text,
  target_source_updated_at timestamptz,target_last_successful_sync timestamptz,
  target_evidence_reference text,target_evidence_digest text,
  target_idempotency_key text,target_correlation_id text
) returns public.partner_location_capability_evidence language plpgsql security definer set search_path=''
as $$
declare current public.partner_applications; evidence public.partner_location_capability_evidence;
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator role required'; end if;
  select * into current from public.partner_applications where id=target_application_id for update;
  if current.applicant_user_id=auth.uid() then raise exception 'Self-certification is prohibited'; end if;
  if current.organization_id is null then raise exception 'Canonical organization is unresolved'; end if;
  if not exists(select 1 from public.pharmacy_locations where id=target_location_id and organization_id=current.organization_id and deleted_at is null) then raise exception 'Location does not belong to the partner organization'; end if;
  insert into public.partner_location_capability_evidence(
    application_id,organization_id,pharmacy_location_id,credential_status,
    inventory_integration_status,inventory_freshness_status,medication_mapping_status,
    payment_capability_status,fulfillment_capability_status,freshness_policy_reference,
    source_updated_at,last_successful_sync,evidence_reference,evidence_digest,verified_by
  ) values(current.id,current.organization_id,target_location_id,target_credential_status,
    target_inventory_integration_status,target_inventory_freshness_status,target_medication_mapping_status,
    target_payment_capability_status,target_fulfillment_capability_status,target_freshness_policy_reference,
    target_source_updated_at,target_last_successful_sync,target_evidence_reference,target_evidence_digest,auth.uid())
  on conflict(application_id,pharmacy_location_id) do update set
    credential_status=excluded.credential_status,inventory_integration_status=excluded.inventory_integration_status,
    inventory_freshness_status=excluded.inventory_freshness_status,medication_mapping_status=excluded.medication_mapping_status,
    payment_capability_status=excluded.payment_capability_status,fulfillment_capability_status=excluded.fulfillment_capability_status,
    freshness_policy_reference=excluded.freshness_policy_reference,source_updated_at=excluded.source_updated_at,
    last_successful_sync=excluded.last_successful_sync,evidence_reference=excluded.evidence_reference,
    evidence_digest=excluded.evidence_digest,verified_by=auth.uid(),verified_at=now()
  returning * into evidence;
  perform public.record_partner_event(current.id,auth.uid(),'partner.location-capability.verified.v1',current.relationship_status,current.relationship_status,current.onboarding_stage,current.onboarding_stage,null,target_correlation_id,target_idempotency_key);
  return evidence;
end $$;
revoke all on function public.record_partner_location_capability(uuid,uuid,public.partner_verification_status,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text) from public;
grant execute on function public.record_partner_location_capability(uuid,uuid,public.partner_verification_status,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text) to authenticated;

create or replace function public.partner_location_network_state(target_location_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  with state as (
    select a.id application_id,a.relationship_status,l.id location_id,l.is_active,
      l.deleted_at,l.license_number,e.credential_status,e.inventory_integration_status,
      e.inventory_freshness_status,e.medication_mapping_status,e.payment_capability_status,
      e.fulfillment_capability_status,e.freshness_policy_reference
    from public.pharmacy_locations l
    left join lateral (
      select candidate.* from public.partner_applications candidate
      where candidate.organization_id=l.organization_id and candidate.deleted_at is null
      order by candidate.created_at desc limit 1
    ) a on true
    left join public.partner_location_capability_evidence e on e.application_id=a.id and e.pharmacy_location_id=l.id
    where l.id=target_location_id
    limit 1
  ), blockers as (
    select array_remove(array[
      case when application_id is not null and relationship_status<>'active' then 'partner_not_active' end,
      case when not is_active or deleted_at is not null then 'location_not_active' end,
      case when license_number is null then 'location_credential_missing' end,
      case when application_id is not null and credential_status is distinct from 'verified' then 'location_credential_unverified' end,
      case when application_id is not null and inventory_integration_status is distinct from 'healthy' then 'inventory_integration_unhealthy' end,
      case when application_id is not null and inventory_freshness_status is distinct from 'current' then 'inventory_not_current' end,
      case when application_id is not null and freshness_policy_reference is null then 'inventory_freshness_policy_required' end,
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
    else jsonb_build_object('networkReady',cardinality((select value from blockers))=0,'legacyNetwork',false,'blockers',to_jsonb((select value from blockers))) end
$$;
revoke all on function public.partner_location_network_state(uuid) from public;
grant execute on function public.partner_location_network_state(uuid) to authenticated;

create or replace function public.is_location_network_eligible(target_location_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select coalesce((public.partner_location_network_state(target_location_id)->>'networkReady')::boolean,false) $$;
revoke all on function public.is_location_network_eligible(uuid) from public;
grant execute on function public.is_location_network_eligible(uuid) to authenticated;

-- Converge the canonical availability query. Existing pre-Partner Engine
-- organizations remain legacy-network eligible; any organization with a
-- Partner relationship must satisfy the derived location chain.
create or replace function public.search_inventory_availability(
  target_organization_id uuid,target_medicine_id uuid default null,
  target_pharmacy_location_id uuid default null,target_quantity integer default 1
) returns table(
  inventory_id uuid,pharmacy_location_id uuid,pharmacy_name text,medicine_id uuid,
  brand_name text,generic_name text,strength text,batch_number text,expires_on date,
  available_quantity integer,unit text,unit_price_minor bigint,currency_code text,
  availability_state text
) language plpgsql stable security definer set search_path=''
as $$
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
  join public.pharmacy_locations location on location.id=batch.pharmacy_location_id and location.organization_id=batch.organization_id
  join public.medicines medicine on medicine.id=batch.medicine_id
  where batch.organization_id=target_organization_id
    and (target_medicine_id is null or batch.medicine_id=target_medicine_id)
    and (target_pharmacy_location_id is null or batch.pharmacy_location_id=target_pharmacy_location_id)
    and batch.status='available' and batch.deleted_at is null and batch.expires_on>=current_date
    and batch.available_quantity>=target_quantity and location.is_active and location.deleted_at is null
    and medicine.status='active' and medicine.deleted_at is null
    and public.is_location_network_eligible(location.id)
  order by medicine.id,batch.expires_on,batch.available_quantity desc,batch.id;
end $$;
revoke all on function public.search_inventory_availability(uuid,uuid,uuid,integer) from public;
grant execute on function public.search_inventory_availability(uuid,uuid,uuid,integer) to authenticated;

alter table public.partner_location_capability_evidence enable row level security;
create policy partner_location_capability_read on public.partner_location_capability_evidence for select to authenticated
  using(public.can_access_partner_application(application_id));
revoke all on public.partner_location_capability_evidence from anon,authenticated;
grant select on public.partner_location_capability_evidence to authenticated;

comment on function public.partner_location_network_state(uuid) is 'Derived Partner Network readiness. No caller can set networkReady directly. Pre-Partner Engine locations are explicitly identified as legacyNetwork.';
