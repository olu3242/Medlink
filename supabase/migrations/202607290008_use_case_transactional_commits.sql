-- Track A S01.8 remediation: atomic use-case commits.
--
-- `record_runtime_evidence` (202607270006) lets an application layer record
-- audit + outbox evidence in one statement, but the two admin/catalog use
-- cases that mutate business state still issue that call from a *separate*
-- network round trip after the business insert/update already committed.
-- That is not a single transaction: if the evidence call fails, the business
-- mutation has already landed with no audit or outbox record.
--
-- These functions close that gap for the Wave 2 (Medicine Knowledge,
-- Prescription Intelligence) use cases already implemented on this branch by
-- performing the business mutation and the evidence commit inside one
-- PL/pgSQL function body, so both commit or both roll back together. They
-- are SECURITY DEFINER (like `record_runtime_evidence` and
-- `is_platform_admin`) and therefore re-implement the authorization checks
-- that the equivalent RLS policies (`medicines_admin`, `prescriptions_create`)
-- would otherwise enforce, since SECURITY DEFINER bypasses RLS.

create or replace function public.create_medicine_record(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_brand_name text,
  target_generic_name text,
  target_dosage_form text,
  target_route text,
  target_strength_display text,
  target_manufacturer_name text,
  target_controlled_substance boolean
)
returns public.medicines
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.medicines;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Medicine catalog management requires platform admin';
  end if;

  insert into public.medicines (
    brand_name, generic_name, dosage_form, route, strength_display,
    manufacturer_name, controlled_substance, status
  ) values (
    target_brand_name, target_generic_name, target_dosage_form, target_route,
    target_strength_display, target_manufacturer_name,
    coalesce(target_controlled_substance, false), 'draft'
  )
  returning * into created;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'catalog.medicines.create',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'medicine', created.id::text, null,
    jsonb_build_object(
      'brandName', created.brand_name, 'genericName', created.generic_name,
      'status', created.status
    ),
    null, null, target_channel, 'medicine.created',
    jsonb_build_object('medicineId', created.id)
  );

  return created;
end;
$$;

revoke all on function public.create_medicine_record(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean
) from public;
grant execute on function public.create_medicine_record(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean
) to authenticated;

create or replace function public.update_medicine_record(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_medicine_id uuid,
  target_changes jsonb
)
returns public.medicines
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.medicines;
  key text;
  allowed_keys text[] := array[
    'brand_name', 'generic_name', 'dosage_form', 'route', 'strength_display',
    'manufacturer_name', 'controlled_substance', 'status'
  ];
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Medicine catalog management requires platform admin';
  end if;
  if target_changes is null or target_changes = '{}'::jsonb then
    raise exception 'At least one medicine field change is required';
  end if;
  for key in select jsonb_object_keys(target_changes) loop
    if not (key = any(allowed_keys)) then
      raise exception 'Unsupported medicine field %', key;
    end if;
  end loop;

  update public.medicines set
    brand_name = coalesce(target_changes->>'brand_name', brand_name),
    generic_name = coalesce(target_changes->>'generic_name', generic_name),
    dosage_form = coalesce(target_changes->>'dosage_form', dosage_form),
    route = coalesce(target_changes->>'route', route),
    strength_display = coalesce(
      target_changes->>'strength_display', strength_display
    ),
    manufacturer_name = case when target_changes ? 'manufacturer_name'
      then target_changes->>'manufacturer_name' else manufacturer_name end,
    controlled_substance = case when target_changes ? 'controlled_substance'
      then (target_changes->>'controlled_substance')::boolean
      else controlled_substance end,
    status = coalesce(target_changes->>'status', status)
  where id = target_medicine_id and deleted_at is null
  returning * into updated;

  if updated.id is null then
    raise exception 'Medicine not found';
  end if;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'catalog.medicines.update',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'medicine', updated.id::text, null,
    jsonb_build_object('changes', target_changes, 'status', updated.status),
    null, null, target_channel, 'medicine.updated',
    jsonb_build_object('medicineId', updated.id)
  );

  return updated;
end;
$$;

revoke all on function public.update_medicine_record(
  uuid, uuid, text, text, text, text, uuid, jsonb
) from public;
grant execute on function public.update_medicine_record(
  uuid, uuid, text, text, text, text, uuid, jsonb
) to authenticated;

create or replace function public.create_prescription_record(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_patient_id uuid,
  target_source public.prescription_source,
  target_storage_bucket text,
  target_storage_object_path text,
  target_external_reference text
)
returns public.prescriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.prescriptions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Tenant membership is invalid';
  end if;
  if target_patient_id is distinct from target_actor_id
     and not public.has_organization_role(
       target_organization_id,
       array['platform_admin', 'tenant_admin', 'pharmacist',
             'pharmacy_staff']::public.member_role[]
     )
  then
    raise exception 'Actor may not upload a prescription for this patient';
  end if;

  insert into public.prescriptions (
    organization_id, patient_id, source, storage_bucket, storage_object_path,
    external_reference, uploaded_by, status
  ) values (
    target_organization_id, target_patient_id, target_source,
    target_storage_bucket, target_storage_object_path,
    target_external_reference, target_actor_id, 'received'
  )
  returning * into created;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'prescriptions.create',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'prescription', created.id::text, null,
    jsonb_build_object('status', created.status, 'source', created.source),
    null, null, target_channel, 'prescription.uploaded',
    jsonb_build_object('prescriptionId', created.id)
  );

  return created;
end;
$$;

revoke all on function public.create_prescription_record(
  uuid, uuid, text, text, text, text, uuid, public.prescription_source, text,
  text, text
) from public;
grant execute on function public.create_prescription_record(
  uuid, uuid, text, text, text, text, uuid, public.prescription_source, text,
  text, text
) to authenticated;

comment on function public.create_medicine_record is
  'Atomic Wave 2 use case: commits a new medicine record and its runtime evidence in one transaction.';
comment on function public.update_medicine_record is
  'Atomic Wave 2 use case: commits a medicine record change and its runtime evidence in one transaction.';
comment on function public.create_prescription_record is
  'Atomic Wave 2 use case: commits a new prescription record and its runtime evidence in one transaction.';
