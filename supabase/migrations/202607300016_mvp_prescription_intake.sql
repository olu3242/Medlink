-- RC2 ML-CAP-003 Batch 1: private, scanned and atomic prescription intake.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prescriptions-private',
  'prescriptions-private',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.prescription_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  prescription_id uuid not null,
  version integer not null default 1 check (version > 0),
  storage_bucket text not null check (storage_bucket = 'prescriptions-private'),
  storage_object_path text not null,
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status text not null check (scan_status = 'clean'),
  scanner text not null check (btrim(scanner) <> ''),
  created_at timestamptz not null default now(),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete restrict,
  unique (prescription_id, version),
  unique (storage_bucket, storage_object_path)
);

alter table public.prescription_files enable row level security;

create policy prescription_files_tenant_read
  on public.prescription_files for select to authenticated
  using (
    public.is_organization_member(organization_id)
    and (
      exists (
        select 1 from public.prescriptions p
        where p.id = prescription_id and p.patient_id = auth.uid()
      )
      or public.has_organization_role(
        organization_id,
        array['platform_admin', 'tenant_admin', 'pharmacist',
              'pharmacy_owner', 'pharmacy_staff']::public.member_role[]
      )
    )
  );

create policy prescription_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'prescriptions-private'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy prescription_objects_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'prescriptions-private'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.has_organization_role(
        ((storage.foldername(name))[1])::uuid,
        array['platform_admin', 'tenant_admin', 'pharmacist',
              'pharmacy_owner', 'pharmacy_staff']::public.member_role[]
      )
    )
  );

create policy prescription_objects_compensating_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'prescriptions-private'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
    and not exists (
      select 1 from public.prescription_files f
      where f.storage_bucket = bucket_id and f.storage_object_path = name
    )
  );

create or replace function public.create_prescription_intake(
  target_organization_id uuid,
  target_patient_id uuid,
  target_uploaded_by uuid,
  target_bucket text,
  target_path text,
  target_media_type text,
  target_size_bytes bigint,
  target_sha256 text,
  target_scanner text,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
) returns table (
  prescription_id uuid,
  status public.prescription_status,
  workflow_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_prescription_id uuid;
  created_file_id uuid;
  definition_id uuid;
  created_workflow_id uuid;
  existing_id uuid;
begin
  if auth.uid() is null
    or auth.uid() <> target_patient_id
    or auth.uid() <> target_uploaded_by
    or not public.is_organization_member(target_organization_id)
    or target_bucket <> 'prescriptions-private'
    or target_path not like target_organization_id::text || '/' || target_patient_id::text || '/%'
    or btrim(target_idempotency_key) = ''
  then
    raise exception 'invalid prescription intake context' using errcode = '42501';
  end if;

  select (payload->>'prescriptionId')::uuid into existing_id
  from public.runtime_outbox_events
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key || ':uploaded';
  if existing_id is not null then
    if not exists (
      select 1 from public.prescriptions p
      join public.prescription_files f on f.prescription_id = p.id
      where p.id = existing_id
        and f.storage_object_path = target_path
        and f.sha256 = target_sha256
    ) then
      raise exception 'idempotency key was already used for another prescription'
        using errcode = '23505';
    end if;
    return query
      select p.id, p.status, w.id
      from public.prescriptions p
      join public.workflow_runs w
        on w.organization_id = p.organization_id
       and w.subject_type = 'prescription'
       and w.subject_reference = p.id::text
      where p.id = existing_id;
    return;
  end if;

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = target_bucket and object.name = target_path
  ) then
    raise exception 'prescription object does not exist' using errcode = '23503';
  end if;

  insert into public.workflow_definitions (
    organization_id, name, version, definition, definition_sha256,
    is_active, created_by
  ) values (
    target_organization_id,
    'ML-WF-001',
    1,
    '{"capabilityId":"ML-CAP-003","steps":["initialized","validated","stored","queued_for_ocr","completed"]}'::jsonb,
    encode(digest('ML-WF-001:v1:initialized,validated,stored,queued_for_ocr,completed', 'sha256'), 'hex'),
    true,
    auth.uid()
  )
  on conflict (organization_id, name, version) do nothing;

  select id into definition_id
  from public.workflow_definitions
  where organization_id = target_organization_id
    and name = 'ML-WF-001'
    and version = 1;

  insert into public.prescriptions (
    organization_id, patient_id, source, status, storage_bucket,
    storage_object_path, uploaded_by
  ) values (
    target_organization_id, target_patient_id, 'upload', 'received',
    target_bucket, target_path, target_uploaded_by
  ) returning id into created_prescription_id;

  insert into public.prescription_files (
    organization_id, prescription_id, storage_bucket, storage_object_path,
    media_type, size_bytes, sha256, scan_status, scanner
  ) values (
    target_organization_id, created_prescription_id, target_bucket, target_path,
    target_media_type, target_size_bytes, target_sha256, 'clean', target_scanner
  ) returning id into created_file_id;

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, status, subject_type,
    subject_reference, input_reference, output_reference, current_step,
    idempotency_key, correlation_id, started_at, completed_at, created_by
  ) values (
    target_organization_id, definition_id, 'completed', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('patientId', target_patient_id),
    jsonb_build_object('prescriptionId', created_prescription_id, 'fileId', created_file_id),
    'completed', target_idempotency_key, target_correlation_id, now(), now(), auth.uid()
  ) returning id into created_workflow_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  )
  select
    target_organization_id, created_workflow_id, stage.event_type,
    stage.step_name, auth.uid(), target_idempotency_key || stage.key_suffix,
    jsonb_build_object('workflowVersion', 1, 'capabilityId', 'ML-CAP-003')
  from (values
    ('workflow.started.v1', 'initialized', ':workflow:started'),
    ('workflow.step.completed.v1', 'validated', ':workflow:validated'),
    ('workflow.step.completed.v1', 'stored', ':workflow:stored'),
    ('workflow.step.completed.v1', 'queued_for_ocr', ':workflow:queued'),
    ('workflow.completed.v1', 'completed', ':workflow:completed')
  ) as stage(event_type, step_name, key_suffix);

  insert into public.prescription_extractions (
    organization_id, prescription_id, status, correlation_id
  ) values (
    target_organization_id, created_prescription_id, 'queued', target_correlation_id
  );

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values
  (
    target_organization_id, 'prescription.upload.started.v1', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('tenantId', target_organization_id, 'prescriptionId', created_prescription_id, 'workflowId', created_workflow_id),
    target_correlation_id, target_request_id, target_idempotency_key || ':started'
  ),
  (
    target_organization_id, 'prescription.uploaded.v1', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('tenantId', target_organization_id, 'prescriptionId', created_prescription_id, 'patientId', target_patient_id),
    target_correlation_id, target_request_id, target_idempotency_key || ':uploaded'
  ),
  (
    target_organization_id, 'prescription.validated.v1', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('tenantId', target_organization_id, 'prescriptionId', created_prescription_id, 'scanStatus', 'clean'),
    target_correlation_id, target_request_id, target_idempotency_key || ':validated'
  ),
  (
    target_organization_id, 'prescription.stored.v1', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('tenantId', target_organization_id, 'prescriptionId', created_prescription_id, 'fileId', created_file_id),
    target_correlation_id, target_request_id, target_idempotency_key || ':stored'
  ),
  (
    target_organization_id, 'prescription.queued-for-ocr.v1', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('tenantId', target_organization_id, 'prescriptionId', created_prescription_id, 'workflowId', created_workflow_id),
    target_correlation_id, target_request_id, target_idempotency_key || ':queued'
  ),
  (
    target_organization_id, 'prescription.upload.completed.v1', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('tenantId', target_organization_id, 'prescriptionId', created_prescription_id, 'workflowId', created_workflow_id),
    target_correlation_id, target_request_id, target_idempotency_key || ':completed'
  );

  return query select
    created_prescription_id,
    'received'::public.prescription_status,
    created_workflow_id;
end;
$$;

revoke all on function public.create_prescription_intake(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, text
) from public;
grant execute on function public.create_prescription_intake(
  uuid, uuid, uuid, text, text, text, bigint, text, text, text, text, text
) to authenticated;

comment on table public.prescription_files is
  'Immutable, tenant-scoped evidence for scanned prescription source files.';
