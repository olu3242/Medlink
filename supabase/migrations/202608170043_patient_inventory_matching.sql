-- Close the patient discovery/matching boundary without introducing a
-- second reservation system. The experience contract already authorizes
-- patient inventory reads; this policy exposes only active, in-stock,
-- unexpired batches in the patient's current tenant.
create policy inventory_batches_patient_discovery
  on public.inventory_batches for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['patient']::public.member_role[]
    )
    and deleted_at is null
    and status = 'available'
    and quantity_on_hand > quantity_reserved
    and expires_on >= current_date
  );

create or replace function public.match_inventory(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_mar_id uuid,
  target_inventory_batch_id uuid,
  target_pharmacy_location_id uuid
)
returns public.medication_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  mar public.medication_access_requests;
  batch public.inventory_batches;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'An idempotency key is required';
  end if;

  select * into mar from public.medication_access_requests
  where id = target_mar_id and organization_id = target_organization_id;
  if not found or mar.patient_id is distinct from target_actor_id then
    raise exception 'Medication access request not found';
  end if;

  select * into batch from public.inventory_batches
  where id = target_inventory_batch_id
    and organization_id = target_organization_id
    and pharmacy_location_id = target_pharmacy_location_id;
  if not found
     or batch.medicine_id is distinct from mar.requested_medicine_id
     or batch.deleted_at is not null
     or batch.status <> 'available'
     or batch.expires_on < current_date
     or batch.quantity_on_hand <= batch.quantity_reserved then
    raise exception 'Inventory is not an eligible canonical match';
  end if;

  if mar.state = 'matched'
     and mar.transition_idempotency_key = target_idempotency_key || ':matched' then
    return mar;
  end if;
  if mar.state <> 'reviewed' then
    raise exception 'Medication access request must be reviewed before matching';
  end if;

  update public.medication_access_requests
  set state = 'searching',
      transition_idempotency_key = target_idempotency_key || ':searching'
  where id = mar.id and organization_id = target_organization_id;

  update public.medication_access_requests
  set state = 'matched',
      transition_idempotency_key = target_idempotency_key || ':matched'
  where id = mar.id and organization_id = target_organization_id
  returning * into mar;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'inventory.match', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'medication_access_request', mar.id::text,
    jsonb_build_object('state', 'reviewed'),
    jsonb_build_object(
      'state', 'matched',
      'medicineId', mar.requested_medicine_id,
      'inventoryBatchId', batch.id,
      'pharmacyLocationId', batch.pharmacy_location_id
    ),
    null, null, target_channel, 'mar.inventory_matched',
    jsonb_build_object(
      'marId', mar.id,
      'medicineId', mar.requested_medicine_id,
      'inventoryBatchId', batch.id,
      'pharmacyLocationId', batch.pharmacy_location_id
    )
  );

  return mar;
end;
$$;

revoke all on function public.match_inventory(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid
) from public;
grant execute on function public.match_inventory(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid
) to authenticated;

comment on function public.match_inventory is
  'Atomically validates canonical inventory identity and walks a patient-owned reviewed MAR through searching to matched without creating an inventory lock.';
