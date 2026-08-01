-- G05 Prescription Intake Runtime, Engine 26: secure prescription file
-- storage.
--
-- docs/audit/LAUNCH_GAP_MATRIX.md's G05 finding: `prescriptions.storage_bucket`/
-- `storage_object_path` (migration 202607270002) have existed since Wave 2,
-- with a CHECK constraint requiring both when source = 'upload' -- but
-- nothing in this repository has ever provisioned a real Storage bucket,
-- an access-control policy for it, or a code path that actually uploads
-- bytes. This migration is that missing piece: the bucket, its RLS, and
-- the checksum/mime/size metadata columns needed for validation and
-- duplicate detection. It does not touch create_prescription_record's
-- existing behavior for any caller that doesn't pass the new params (see
-- below) -- apps/admin/lib/application.ts's PrescriptionApplication.create()
-- needs no changes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prescriptions',
  'prescriptions',
  false,
  15728640, -- 15 MiB, matching packages/prescription's file-validation.ts
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Object key convention: {organization_id}/{patient_id}/{object id}-{filename}.
-- No prescription_id segment: the file must be uploaded to storage *before*
-- create_prescription_record can be called (its storage_object_path is a
-- required input, not an output), so no prescription id exists yet at
-- upload time.
create policy prescriptions_bucket_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'prescriptions'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.has_organization_role(
        ((storage.foldername(name))[1])::uuid,
        array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_staff']::public.member_role[]
      )
    )
  );

create policy prescriptions_bucket_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'prescriptions'
    and public.is_organization_member(((storage.foldername(name))[1])::uuid)
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.has_organization_role(
        ((storage.foldername(name))[1])::uuid,
        array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_staff']::public.member_role[]
      )
    )
  );

-- No update/delete policy: a prescription image is immutable once
-- uploaded, the same "never expose, never silently mutate" posture the
-- rest of this platform's audit trails already take (conversation_events,
-- mar_audit_events, governance_audit_events all forbid mutation outright).

alter table public.prescriptions
  add column storage_checksum text,
  add column storage_mime_type text,
  add column storage_size_bytes bigint;

-- Duplicate detection, scoped per tenant (matching every other
-- content-addressed uniqueness constraint in this repository --
-- conversation_messages.external_message_id, mar_audit_events'
-- idempotency key -- none scope tighter than the tenant boundary). A
-- checksum collision within an organization is treated as the same
-- upload having already been received, not two coincidentally-identical
-- prescriptions from two different patients.
create unique index prescriptions_org_checksum_idx
  on public.prescriptions(organization_id, storage_checksum)
  where storage_checksum is not null;

-- Backward-compatible extension: three new trailing parameters, each
-- defaulting to null. Postgres identifies a function by its full argument
-- list, so a plain create-or-replace with more required parameters would
-- create a second, ambiguous overload rather than truly replacing the
-- original -- the explicit drop first is what makes this the same single
-- callable function old and new callers share. PostgREST (the only caller,
-- apps/admin/lib/application.ts's PrescriptionApplication.create()) omits
-- keys it doesn't set, and Postgres applies the default for a parameter
-- that's absent from the call -- so that existing caller needs no changes
-- and its behavior is unchanged.
drop function if exists public.create_prescription_record(
  uuid, uuid, text, text, text, text, uuid, public.prescription_source, text, text, text
);

create function public.create_prescription_record(
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
  target_external_reference text,
  target_storage_checksum text default null,
  target_storage_mime_type text default null,
  target_storage_size_bytes bigint default null
)
returns public.prescriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.prescriptions;
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

  -- Idempotent replay on a content duplicate: the same checksum
  -- resubmitted within the same organization (a retried upload after a
  -- dropped response, or a genuinely repeated file) returns the row that
  -- prescriptions_org_checksum_idx already proves exists, rather than
  -- racing it and erroring. Only meaningful when a checksum was actually
  -- supplied -- electronic-source prescriptions and callers on the old
  -- 11-argument shape never hit this branch.
  if target_storage_checksum is not null then
    select * into existing from public.prescriptions
    where organization_id = target_organization_id
      and storage_checksum = target_storage_checksum;
    if found then
      return existing;
    end if;
  end if;

  insert into public.prescriptions (
    organization_id, patient_id, source, storage_bucket, storage_object_path,
    external_reference, uploaded_by, status,
    storage_checksum, storage_mime_type, storage_size_bytes
  ) values (
    target_organization_id, target_patient_id, target_source,
    target_storage_bucket, target_storage_object_path,
    target_external_reference, target_actor_id, 'received',
    target_storage_checksum, target_storage_mime_type, target_storage_size_bytes
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
  text, text, text, text, bigint
) from public;
grant execute on function public.create_prescription_record(
  uuid, uuid, text, text, text, text, uuid, public.prescription_source, text,
  text, text, text, text, bigint
) to authenticated;

comment on function public.create_prescription_record is
  'Atomic Wave 2 use case: commits a new prescription record and its runtime evidence in one transaction. Extended (G05, migration 202608010003) with optional checksum/mime-type/size-bytes metadata; a checksum match within the same organization replays the existing row rather than erroring, giving both idempotent retry and duplicate-upload detection from the one signal.';
