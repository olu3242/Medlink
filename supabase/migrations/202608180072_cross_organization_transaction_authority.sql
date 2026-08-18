-- Carry the patient tenant and pharmacy inventory tenant explicitly through
-- the existing reservation. This is one reservation/payment/fulfillment
-- workflow, not a parallel marketplace transaction engine.

alter table public.reservations add column pharmacy_organization_id uuid;
update public.reservations reservation
set pharmacy_organization_id = location.organization_id
from public.pharmacy_locations location
where location.id = reservation.pharmacy_location_id;
alter table public.reservations alter column pharmacy_organization_id set not null;
alter table public.reservations
  add constraint reservations_pharmacy_organization_fk
  foreign key (pharmacy_organization_id) references public.organizations(id);
alter table public.reservations
  drop constraint if exists reservations_pharmacy_location_id_organization_id_fkey;
alter table public.reservations
  add constraint reservations_pharmacy_location_authority_fk
  foreign key (pharmacy_location_id, pharmacy_organization_id)
  references public.pharmacy_locations(id, organization_id);

alter table public.inventory_locks add column inventory_organization_id uuid;
update public.inventory_locks lock
set inventory_organization_id = batch.organization_id
from public.inventory_batches batch
where batch.id = lock.inventory_batch_id;
alter table public.inventory_locks alter column inventory_organization_id set not null;
alter table public.inventory_locks
  add constraint inventory_locks_inventory_organization_fk
  foreign key (inventory_organization_id) references public.organizations(id);
alter table public.inventory_locks
  drop constraint if exists inventory_locks_inventory_batch_id_organization_id_fkey;
alter table public.inventory_locks
  add constraint inventory_locks_inventory_authority_fk
  foreign key (inventory_batch_id, inventory_organization_id)
  references public.inventory_batches(id, organization_id) on delete restrict;

create or replace function public.resolve_reservation_pharmacy_organization()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.pharmacy_organization_id is null then
    select organization_id into new.pharmacy_organization_id
    from public.pharmacy_locations where id=new.pharmacy_location_id;
  end if;
  return new;
end;
$$;
create trigger aa_reservation_pharmacy_organization
before insert on public.reservations
for each row execute function public.resolve_reservation_pharmacy_organization();

create or replace function public.resolve_lock_inventory_organization()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.inventory_organization_id is null then
    select organization_id into new.inventory_organization_id
    from public.inventory_batches where id=new.inventory_batch_id;
  end if;
  return new;
end;
$$;
create trigger aa_inventory_lock_organization
before insert on public.inventory_locks
for each row execute function public.resolve_lock_inventory_organization();

create or replace function public.sync_inventory_lock_quantity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_active_quantity integer := 0;
  new_active_quantity integer := 0;
  consumed_quantity integer := 0;
  quantity_delta integer;
begin
  if tg_op = 'DELETE' then
    raise exception 'Inventory locks cannot be deleted; release or expire them';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id <> old.organization_id
    or new.inventory_organization_id <> old.inventory_organization_id
    or new.inventory_batch_id <> old.inventory_batch_id
    or new.reservation_id <> old.reservation_id
  ) then
    raise exception 'Inventory lock ownership fields are immutable';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'active' and new.status <> old.status then
    raise exception 'A finalized inventory lock cannot transition again';
  end if;
  if tg_op = 'UPDATE' and old.status = 'active'
     and new.status not in ('active','consumed','released','expired') then
    raise exception 'Invalid inventory lock transition';
  end if;
  if tg_op = 'UPDATE' and old.status = 'active'
     and new.status <> 'active' and new.quantity <> old.quantity then
    raise exception 'Lock quantity cannot change while finalizing';
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then old_active_quantity := old.quantity; end if;
  if new.status = 'active' then new_active_quantity := new.quantity; end if;
  quantity_delta := new_active_quantity - old_active_quantity;
  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'consumed' then
    consumed_quantity := old.quantity;
  end if;

  if quantity_delta <> 0 or consumed_quantity <> 0 then
    update public.inventory_batches
    set quantity_on_hand = quantity_on_hand - consumed_quantity,
        quantity_reserved = quantity_reserved + quantity_delta,
        updated_at = now()
    where id = new.inventory_batch_id
      and organization_id = new.inventory_organization_id
      and deleted_at is null
      and (
        (quantity_delta <= 0 and consumed_quantity = 0)
        or (status = 'available' and expires_on >= current_date)
      )
      and quantity_on_hand - consumed_quantity >= 0
      and quantity_reserved + quantity_delta between 0
        and quantity_on_hand - consumed_quantity;
    if not found then raise exception 'Insufficient or unavailable inventory for lock'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_inventory_lock_transaction()
returns trigger language plpgsql security definer set search_path='' as $$
declare batch_row record; transaction_kind public.inventory_transaction_kind;
  on_hand_before integer; reserved_before integer; quantity_delta integer:=0;
  reserved_delta integer:=0; reason text; content_hash text; operation_key text;
begin
  if tg_op='UPDATE' and old.status=new.status then return new; end if;
  select batch.* into strict batch_row from public.inventory_batches batch
    where batch.id=new.inventory_batch_id and batch.organization_id=new.inventory_organization_id;
  if tg_op='INSERT' then
    transaction_kind:='reserve'; on_hand_before:=batch_row.quantity_on_hand;
    reserved_before:=batch_row.quantity_reserved-new.quantity; reserved_delta:=new.quantity;
    reason:='Inventory reserved'; operation_key:=new.idempotency_key||':reserved';
  elsif old.status='active' and new.status='consumed' then
    transaction_kind:='dispense'; on_hand_before:=batch_row.quantity_on_hand+old.quantity;
    reserved_before:=batch_row.quantity_reserved+old.quantity; quantity_delta:=-old.quantity;
    reserved_delta:=-old.quantity; reason:='Reserved inventory dispensed';
    operation_key:=new.idempotency_key||':consumed';
  elsif old.status='active' and new.status='expired' then
    transaction_kind:='expiry'; on_hand_before:=batch_row.quantity_on_hand;
    reserved_before:=batch_row.quantity_reserved+old.quantity; reserved_delta:=-old.quantity;
    reason:='Expired inventory hold released'; operation_key:=new.idempotency_key||':expired';
  elsif old.status='active' and new.status='released' then
    transaction_kind:='release'; on_hand_before:=batch_row.quantity_on_hand;
    reserved_before:=batch_row.quantity_reserved+old.quantity; reserved_delta:=-old.quantity;
    reason:='Inventory hold released'; operation_key:=new.idempotency_key||':released';
  else return new; end if;
  content_hash:=encode(public.digest(convert_to(jsonb_build_object(
    'lockId',new.id,'reservationId',new.reservation_id,'inventoryId',new.inventory_batch_id,
    'kind',transaction_kind,'quantity',new.quantity,'status',new.status
  )::text,'UTF8'),'sha256'),'hex');
  perform public._record_inventory_transaction(
    new.inventory_organization_id,new.inventory_batch_id,transaction_kind,quantity_delta,
    reserved_delta,on_hand_before,batch_row.quantity_on_hand,reserved_before,
    batch_row.quantity_reserved,reason,operation_key,
    coalesce(new.correlation_id,new.idempotency_key),coalesce(new.request_id,new.id::text),
    content_hash,jsonb_build_object('lockId',new.id,'reservationId',new.reservation_id,
      'lockStatus',new.status)
  );
  return new;
end;
$$;

drop policy if exists reservations_read on public.reservations;
create policy reservations_read on public.reservations for select to authenticated
using (
  patient_id = auth.uid()
  or public.has_organization_role(
    pharmacy_organization_id,
    array['platform_admin','tenant_admin','pharmacist','pharmacy_owner',
      'pharmacy_staff','inventory_manager']::public.member_role[]
  )
);
drop policy if exists reservations_manage on public.reservations;
create policy reservations_manage on public.reservations for update to authenticated
using (public.has_organization_role(
  pharmacy_organization_id,
  array['pharmacist','pharmacy_staff']::public.member_role[]
))
with check (public.has_organization_role(
  pharmacy_organization_id,
  array['pharmacist','pharmacy_staff']::public.member_role[]
));

drop policy if exists inventory_locks_member_read on public.inventory_locks;
create policy inventory_locks_member_read on public.inventory_locks for select to authenticated
using (public.has_organization_role(
  inventory_organization_id,
  array['platform_admin','tenant_admin','pharmacist','pharmacy_owner',
    'pharmacy_staff','inventory_manager']::public.member_role[]
));
drop policy if exists inventory_locks_manage on public.inventory_locks;
create policy inventory_locks_manage on public.inventory_locks for all to authenticated
using (public.has_organization_role(
  inventory_organization_id,
  array['pharmacist','pharmacy_staff','inventory_manager']::public.member_role[]
))
with check (public.has_organization_role(
  inventory_organization_id,
  array['pharmacist','pharmacy_staff','inventory_manager']::public.member_role[]
));

create or replace function public.match_inventory(
  target_organization_id uuid,target_actor_id uuid,target_correlation_id text,
  target_request_id text,target_idempotency_key text,target_channel text,
  target_mar_id uuid,target_inventory_batch_id uuid,target_pharmacy_location_id uuid
)
returns public.medication_access_requests
language plpgsql security definer set search_path = '' as $$
declare mar public.medication_access_requests; batch public.inventory_batches;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid()
     or not public.has_organization_role(
       target_organization_id,array['patient']::public.member_role[]
     ) then raise exception 'Authenticated patient context is invalid' using errcode='42501'; end if;
  if btrim(coalesce(target_idempotency_key,''))='' then raise exception 'An idempotency key is required'; end if;
  select * into mar from public.medication_access_requests
  where id=target_mar_id and organization_id=target_organization_id;
  if not found or mar.patient_id is distinct from target_actor_id then
    raise exception 'Medication access request not found';
  end if;
  select * into batch from public.inventory_batches
  where id=target_inventory_batch_id and pharmacy_location_id=target_pharmacy_location_id;
  if not found or batch.medicine_id is distinct from mar.requested_medicine_id
     or not public.is_inventory_batch_discoverable(batch.id) then
    raise exception 'Inventory is not an eligible canonical match';
  end if;
  if batch.organization_id <> target_organization_id and not exists (
    select 1 from public.consent_records consent
    where consent.organization_id=target_organization_id
      and consent.subject_user_id=target_actor_id
      and consent.consent_type='marketplace_location_discovery'
      and consent.action='granted'
      and not exists(select 1 from public.consent_records successor where successor.supersedes_id=consent.id)
  ) then raise exception 'Cross-organization match requires current marketplace consent' using errcode='42501'; end if;
  if mar.state='matched' and mar.transition_idempotency_key=target_idempotency_key||':matched' then return mar; end if;
  if mar.state<>'reviewed' then raise exception 'Medication access request must be reviewed before matching'; end if;
  update public.medication_access_requests set state='searching',transition_idempotency_key=target_idempotency_key||':searching'
    where id=mar.id and organization_id=target_organization_id;
  update public.medication_access_requests set state='matched',transition_idempotency_key=target_idempotency_key||':matched'
    where id=mar.id and organization_id=target_organization_id returning * into mar;
  perform public.record_runtime_evidence(
    target_organization_id,target_actor_id,'inventory.match','success',target_correlation_id,
    target_request_id,target_idempotency_key,'medication_access_request',mar.id::text,
    jsonb_build_object('state','reviewed'),
    jsonb_build_object('state','matched','medicineId',mar.requested_medicine_id,
      'inventoryBatchId',batch.id,'pharmacyLocationId',batch.pharmacy_location_id),
    null,null,target_channel,'mar.inventory_matched',
    jsonb_build_object('marId',mar.id,'medicineId',mar.requested_medicine_id,
      'inventoryBatchId',batch.id,'pharmacyLocationId',batch.pharmacy_location_id)
  );
  return mar;
end;
$$;

create or replace function public.reserve_inventory(
  target_organization_id uuid,target_actor_id uuid,target_correlation_id text,
  target_request_id text,target_idempotency_key text,target_channel text,
  target_mar_id uuid,target_pharmacy_location_id uuid,target_inventory_batch_id uuid,
  target_quantity integer,target_expires_at timestamptz
)
returns public.reservations language plpgsql security definer set search_path='' as $$
declare mar public.medication_access_requests; batch public.inventory_batches;
  existing public.reservations; existing_lock public.inventory_locks; created public.reservations;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid()
     or not public.is_organization_member(target_organization_id) then
    raise exception 'Authenticated patient context is invalid' using errcode='42501'; end if;
  if target_quantity is null or target_quantity<=0 then raise exception 'Reservation quantity must be positive'; end if;
  if target_expires_at<=now() then raise exception 'Reservation expiry must be in the future'; end if;
  select * into existing from public.reservations
    where organization_id=target_organization_id and idempotency_key=target_idempotency_key;
  if found then
    select * into existing_lock from public.inventory_locks
      where organization_id=target_organization_id and reservation_id=existing.id;
    if not found then raise exception 'Existing reservation has no inventory lock'; end if;
    if existing.mar_id<>target_mar_id or existing.pharmacy_location_id<>target_pharmacy_location_id
       or existing_lock.inventory_batch_id<>target_inventory_batch_id
       or existing_lock.quantity<>target_quantity then
      raise exception 'Idempotency key was already used for a different reservation';
    end if;
    return existing;
  end if;
  select * into mar from public.medication_access_requests
    where id=target_mar_id and organization_id=target_organization_id and deleted_at is null;
  if not found then raise exception 'Medication access request not found'; end if;
  if mar.patient_id is distinct from target_actor_id
     and not public.has_organization_role(
       target_organization_id,
       array['pharmacist','pharmacy_staff']::public.member_role[]
     ) then
    raise exception 'Actor may not reserve inventory for this medication access request';
  end if;
  if mar.state<>'matched' then raise exception 'Medication access request must be matched before reservation'; end if;
  select * into batch from public.inventory_batches
    where id=target_inventory_batch_id and pharmacy_location_id=target_pharmacy_location_id
      and deleted_at is null for update;
  if not found then raise exception 'Inventory batch not found'; end if;
  if batch.medicine_id is distinct from mar.requested_medicine_id then
    raise exception 'Inventory batch does not match the requested medicine';
  end if;
  if batch.pharmacy_location_id is distinct from target_pharmacy_location_id then
    raise exception 'Inventory batch does not belong to the requested pharmacy location';
  end if;
  if not public.is_inventory_batch_discoverable(batch.id) then
    raise exception 'Inventory batch is unavailable for reservation';
  end if;
  begin
    insert into public.reservations(
      organization_id,pharmacy_organization_id,mar_id,patient_id,pharmacy_location_id,
      status,idempotency_key,expires_at,created_by
    ) values (
      target_organization_id,batch.organization_id,target_mar_id,mar.patient_id,
      target_pharmacy_location_id,'pending',target_idempotency_key,target_expires_at,target_actor_id
    ) returning * into created;
  exception when unique_violation then
    raise exception 'An open reservation already exists for this medication access request';
  end;
  insert into public.inventory_locks(
    organization_id,inventory_organization_id,reservation_id,inventory_batch_id,
    quantity,idempotency_key,expires_at
  ) values (
    target_organization_id,batch.organization_id,created.id,batch.id,target_quantity,
    target_idempotency_key,target_expires_at
  );
  update public.medication_access_requests set state='reserved',transition_idempotency_key=target_idempotency_key
    where id=target_mar_id and organization_id=target_organization_id;
  perform public.record_runtime_evidence(
    target_organization_id,target_actor_id,'reservations.create','success',target_correlation_id,
    target_request_id,target_idempotency_key,'reservation',created.id::text,null,
    jsonb_build_object('status',created.status,'marId',target_mar_id,
      'inventoryBatchId',target_inventory_batch_id,'quantity',target_quantity),
    null,null,target_channel,'reservation.created',
    jsonb_build_object('reservationId',created.id,'marId',target_mar_id,
      'pharmacyOrganizationId',batch.organization_id)
  );
  return created;
end;
$$;

create or replace function public.certify_partner_browser_location_fixture(
  target_application_id uuid,target_reviewer_id uuid,target_nonce text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare application public.partner_applications; location_id uuid:=gen_random_uuid();
  policy_id uuid:=gen_random_uuid(); source_id uuid:=gen_random_uuid(); policy_reference text;
begin
  if auth.role()<>'service_role' then raise exception 'Service-role certification context required' using errcode='42501'; end if;
  if target_nonce !~ '^[a-z0-9-]{6,80}$' then raise exception 'Certification nonce is invalid'; end if;
  select * into application from public.partner_applications where id=target_application_id;
  if not found or application.organization_id is null then raise exception 'Activated Partner organization is unresolved'; end if;
  if not exists(select 1 from public.organization_memberships
    where user_id=target_reviewer_id and role='platform_admin' and deleted_at is null) then
    raise exception 'Certification reviewer is not a platform administrator';
  end if;
  insert into public.pharmacy_locations(
    id,organization_id,name,license_number,address_line_1,locality,country_code,latitude,longitude
  ) values(location_id,application.organization_id,'Network Location '||target_nonce,
    'PCN-'||target_nonce,'1 Network Way','Lagos','NG',6.5244,3.3792);
  policy_reference:='certification://inventory-freshness/'||target_nonce;
  insert into public.inventory_freshness_policies(
    id,reference,source_type,max_age_seconds,approved_by,approval_evidence,effective_at
  ) values(policy_id,policy_reference,'api',3600,target_reviewer_id,
    'certification://partner-browser/'||target_nonce,now()-interval '1 minute');
  insert into public.inventory_sources(
    id,organization_id,pharmacy_location_id,source_type,name,policy_id,created_by
  ) values(source_id,application.organization_id,location_id,'api','Browser fixture source',
    policy_id,target_reviewer_id);
  insert into public.inventory_source_sync_events(
    organization_id,inventory_source_id,integration_health,source_updated_at,
    synchronized_at,evidence_reference,idempotency_key,recorded_by
  ) values(application.organization_id,source_id,'healthy',now(),now(),
    'certification://partner-browser/sync/'||target_nonce,'partner-browser-sync:'||target_nonce,
    target_reviewer_id);
  return jsonb_build_object('organizationId',application.organization_id,
    'locationId',location_id,'freshnessPolicyReference',policy_reference);
end;
$$;
revoke all on function public.certify_partner_browser_location_fixture(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.certify_partner_browser_location_fixture(uuid,uuid,text)
to service_role;

comment on function public.certify_partner_browser_location_fixture(uuid,uuid,text) is
  'Test-only privileged persistence boundary for Partner Playwright certification. It returns only organization/location identifiers and creates governed freshness evidence; no browser receives service credentials or raw table access.';
