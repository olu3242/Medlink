-- RC2 PI-1: deterministic clinical intake processing.
--
-- This migration deliberately extends the existing workflow and transactional
-- runtime.  It does not introduce a second generic pipeline/queue abstraction.
-- PHI remains in RLS-protected clinical tables; outbox payloads contain only
-- opaque identifiers, hashes, confidence values and state names.

alter table public.runtime_outbox_events
  add column lease_token uuid,
  add column lease_expires_at timestamptz;

-- Preserve any in-flight dispatcher work while adding fencing to the legacy
-- lock shape. New clinical claims always replace this migration-time token.
update public.runtime_outbox_events
set locked_at = coalesce(locked_at, now()),
    locked_by = coalesce(locked_by, 'pre-pi1-dispatcher'),
    lease_token = gen_random_uuid(),
    lease_expires_at = coalesce(locked_at, now()) + interval '5 minutes'
where event_type in (
    'prescription.queued-for-ocr.v1',
    'prescription.queued-for-parsing.v1',
    'prescription.queued-for-clinical-validation.v1'
  )
  and status = 'publishing'::public.runtime_event_status;

alter table public.runtime_outbox_events
  add constraint runtime_outbox_lease_shape check (
    event_type not in (
      'prescription.queued-for-ocr.v1',
      'prescription.queued-for-parsing.v1',
      'prescription.queued-for-clinical-validation.v1'
    )
    or (
      (
        status = 'publishing'::public.runtime_event_status
        and locked_at is not null
        and locked_by is not null
        and lease_token is not null
        and lease_expires_at is not null
        and lease_expires_at > locked_at
      )
      or
      (
        status <> 'publishing'::public.runtime_event_status
        and lease_token is null
        and lease_expires_at is null
      )
    )
  );

create index runtime_outbox_clinical_claim_idx
  on public.runtime_outbox_events(available_at, created_at)
  where event_type in (
    'prescription.queued-for-ocr.v1',
    'prescription.queued-for-parsing.v1',
    'prescription.queued-for-clinical-validation.v1'
  )
  and status in ('pending', 'retrying');

create index runtime_outbox_clinical_expired_lease_idx
  on public.runtime_outbox_events(lease_expires_at)
  where event_type in (
    'prescription.queued-for-ocr.v1',
    'prescription.queued-for-parsing.v1',
    'prescription.queued-for-clinical-validation.v1'
  )
  and status = 'publishing';

alter table public.workflow_runs
  add column parent_workflow_run_id uuid,
  add column previous_step text,
  add column next_step text,
  add column attempt_count integer not null default 0
    check (attempt_count >= 0);

alter table public.workflow_runs
  add constraint workflow_runs_parent_fk
  foreign key (parent_workflow_run_id, organization_id)
  references public.workflow_runs(id, organization_id)
  on delete restrict;

alter table public.workflow_runs
  add constraint workflow_runs_not_own_parent
  check (parent_workflow_run_id is null or parent_workflow_run_id <> id);

create index workflow_runs_parent_idx
  on public.workflow_runs(parent_workflow_run_id, created_at)
  where parent_workflow_run_id is not null;

alter table public.prescription_extractions
  add column pipeline_workflow_run_id uuid;

alter table public.prescription_extractions
  add constraint prescription_extractions_id_org_unique
  unique (id, organization_id);

alter table public.prescription_files
  add constraint prescription_files_id_org_unique
  unique (id, organization_id);

alter table public.prescription_extractions
  add constraint prescription_extractions_pipeline_fk
  foreign key (pipeline_workflow_run_id, organization_id)
  references public.workflow_runs(id, organization_id)
  on delete restrict;

create unique index prescription_extractions_pipeline_idx
  on public.prescription_extractions(pipeline_workflow_run_id)
  where pipeline_workflow_run_id is not null;

alter table public.clinical_validations
  add column workflow_run_id uuid,
  add column decision_rationale text;

alter table public.clinical_validations
  add constraint clinical_validations_id_org_unique
  unique (id, organization_id);

alter table public.clinical_validations
  add constraint clinical_validations_workflow_fk
  foreign key (workflow_run_id, organization_id)
  references public.workflow_runs(id, organization_id)
  on delete restrict;

create unique index clinical_validations_workflow_idx
  on public.clinical_validations(workflow_run_id)
  where workflow_run_id is not null;

create table public.pharmacist_profiles (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id) on delete restrict,
  license_number text not null check (char_length(btrim(license_number)) between 3 and 120),
  issuing_authority text not null
    check (char_length(btrim(issuing_authority)) between 2 and 160),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected', 'suspended')),
  is_active boolean not null default false,
  license_expires_on date,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  unique (organization_id, license_number, issuing_authority),
  check (
    (
      verification_status = 'verified'
      and verified_by is not null
      and verified_at is not null
    )
    or
    (
      verification_status <> 'verified'
      and is_active = false
    )
  )
);

create index pharmacist_profiles_verified_idx
  on public.pharmacist_profiles(organization_id, user_id)
  where verification_status = 'verified' and is_active;

create trigger pharmacist_profiles_set_updated_at
before update on public.pharmacist_profiles
for each row execute function public.set_updated_at();

create table public.prescription_ocr_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  prescription_id uuid not null,
  extraction_id uuid not null,
  prescription_file_id uuid not null,
  workflow_run_id uuid not null,
  provider text not null check (char_length(btrim(provider)) between 1 and 100),
  model text not null check (char_length(btrim(model)) between 1 and 160),
  page_count integer not null check (page_count between 1 and 50),
  confidence numeric(5, 4) not null check (confidence between 0 and 1),
  extracted_text text not null
    check (char_length(extracted_text) between 1 and 200000),
  result_sha256 text not null check (result_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (extraction_id),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete restrict,
  foreign key (extraction_id, organization_id)
    references public.prescription_extractions(id, organization_id)
    on delete restrict,
  foreign key (prescription_file_id, organization_id)
    references public.prescription_files(id, organization_id)
    on delete restrict,
  foreign key (workflow_run_id, organization_id)
    references public.workflow_runs(id, organization_id) on delete restrict
);

create index prescription_ocr_results_prescription_idx
  on public.prescription_ocr_results(organization_id, prescription_id, created_at);

create table public.clinical_evidence_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  prescription_id uuid not null,
  extraction_id uuid not null,
  validation_id uuid not null,
  pipeline_workflow_run_id uuid not null,
  version integer not null default 1 check (version > 0),
  evidence jsonb not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (validation_id, version),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete restrict,
  foreign key (extraction_id, organization_id)
    references public.prescription_extractions(id, organization_id)
    on delete restrict,
  foreign key (validation_id, organization_id)
    references public.clinical_validations(id, organization_id)
    on delete restrict,
  foreign key (pipeline_workflow_run_id, organization_id)
    references public.workflow_runs(id, organization_id) on delete restrict,
  check (
    evidence::text !~* '"(password|secret|token|api_key|private_key|credential|card_number|cvv|cvc)"[[:space:]]*:'
  )
);

create index clinical_evidence_packages_prescription_idx
  on public.clinical_evidence_packages(
    organization_id, prescription_id, created_at desc
  );

create or replace function public.is_verified_active_pharmacist(
  target_organization_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.pharmacist_profiles profile
      on profile.organization_id = membership.organization_id
     and profile.user_id = membership.user_id
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.role = 'pharmacist'::public.member_role
      and membership.deleted_at is null
      and profile.verification_status = 'verified'
      and profile.is_active
      and (
        profile.license_expires_on is null
        or profile.license_expires_on >= current_date
      )
  );
$$;

revoke all on function public.is_verified_active_pharmacist(uuid, uuid)
  from public;
grant execute on function public.is_verified_active_pharmacist(uuid, uuid)
  to authenticated, service_role;

alter table public.pharmacist_profiles enable row level security;
alter table public.prescription_ocr_results enable row level security;
alter table public.clinical_evidence_packages enable row level security;

create policy pharmacist_profiles_read_self_or_admin
  on public.pharmacist_profiles for select to authenticated
  using (
    (
      user_id = auth.uid()
      and public.is_organization_member(organization_id)
    )
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

create policy pharmacist_profiles_admin_manage
  on public.pharmacist_profiles for all to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  )
  with check (
    public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = pharmacist_profiles.organization_id
        and membership.user_id = pharmacist_profiles.user_id
        and membership.role = 'pharmacist'::public.member_role
        and membership.deleted_at is null
    )
    and (
      pharmacist_profiles.verification_status <> 'verified'
      or pharmacist_profiles.verified_by = auth.uid()
    )
  );

create policy prescription_ocr_results_verified_pharmacist_read
  on public.prescription_ocr_results for select to authenticated
  using (
    public.is_verified_active_pharmacist(organization_id, auth.uid())
  );

create policy clinical_evidence_packages_verified_pharmacist_read
  on public.clinical_evidence_packages for select to authenticated
  using (
    public.is_verified_active_pharmacist(organization_id, auth.uid())
  );

create trigger prescription_files_append_only
before update or delete on public.prescription_files
for each row execute function public.prevent_enterprise_event_mutation();

create trigger prescription_ocr_results_append_only
before update or delete on public.prescription_ocr_results
for each row execute function public.prevent_enterprise_event_mutation();

create trigger clinical_evidence_packages_append_only
before update or delete on public.clinical_evidence_packages
for each row execute function public.prevent_enterprise_event_mutation();

comment on table public.pharmacist_profiles is
  'Tenant-scoped pharmacist license verification. Only an active verified pharmacist may make a final clinical decision.';
comment on table public.prescription_ocr_results is
  'Immutable PHI-bearing OCR evidence. Text is RLS-protected and must never be copied into an outbox event or application log.';
comment on table public.clinical_evidence_packages is
  'Immutable authoritative clinical review input. Contains PHI and is readable only by a verified active pharmacist in the same tenant.';

create or replace function public._ensure_clinical_workflow_definitions(
  target_organization_id uuid,
  target_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workflow_definitions (
    organization_id, name, version, definition, definition_sha256,
    is_active, created_by
  )
  select
    target_organization_id,
    definition_row.name,
    1,
    definition_row.definition,
    encode(
      public.digest(
        convert_to(definition_row.definition::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    true,
    target_created_by
  from (
    values
      (
        'ML-CPP-001',
        '{"capabilityId":"ML-CAP-006","kind":"pipeline","stages":["ocr","parsing","clinical_validation","pharmacist_review"],"version":1}'::jsonb
      ),
      (
        'ML-WF-002',
        '{"capabilityId":"ML-CAP-006","kind":"workflow","stage":"ocr","retry":{"maxAttempts":5},"timeoutSeconds":45,"version":1}'::jsonb
      ),
      (
        'ML-WF-003',
        '{"capabilityId":"ML-CAP-006","kind":"workflow","stage":"parsing","retry":{"maxAttempts":5},"timeoutSeconds":45,"version":1}'::jsonb
      ),
      (
        'ML-WF-004',
        '{"capabilityId":"ML-CAP-006","kind":"workflow","stage":"clinical_validation","retry":{"maxAttempts":5},"timeoutSeconds":45,"version":1}'::jsonb
      ),
      (
        'ML-WF-005',
        '{"capabilityId":"ML-CAP-007","kind":"workflow","stage":"pharmacist_review","humanApprovalRequired":true,"version":1}'::jsonb
      )
  ) as definition_row(name, definition)
  on conflict (organization_id, name, version) do nothing;
end;
$$;

-- Forward declaration: the full implementation follows the worker RPCs.
-- Keeping the signature present lets PostgreSQL validate the completion
-- function without exposing an executable placeholder to API roles.
create or replace function public._ensure_clinical_stage_run(
  target_extraction_id uuid,
  target_stage text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'clinical stage runtime is not initialized';
end;
$$;

revoke all on function public._ensure_clinical_stage_run(uuid, text)
  from public;

create or replace function public.complete_clinical_ocr(
  source_event_id uuid,
  worker_id text,
  lease_token uuid,
  result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_event record;
  context_row record;
  existing_result record;
  created_ocr_result_id uuid;
  result_hash text;
  parsing_workflow_id uuid;
  target_ai_run_id uuid;
  numeric_confidence numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'clinical pipeline completion requires service_role'
      using errcode = '42501';
  end if;

  select event.* into strict source_event
  from public.runtime_outbox_events event
  where event.id = public.complete_clinical_ocr.source_event_id
  for update;

  if source_event.event_type <> 'prescription.queued-for-ocr.v1' then
    raise exception 'source event is not an OCR work item'
      using errcode = '22023';
  end if;

  if source_event.status = 'published'::public.runtime_event_status then
    select
      ocr.id,
      ocr.result_sha256,
      ocr.confidence
    into strict existing_result
    from public.prescription_ocr_results ocr
    where ocr.extraction_id =
      (source_event.payload->>'extractionId')::uuid;
    if existing_result.result_sha256 is distinct from encode(
         public.digest(
           convert_to(
             public.complete_clinical_ocr.result::text,
             'UTF8'
           ),
           'sha256'
         ),
         'hex'
       )
    then
      raise exception 'OCR completion replay payload does not match'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ocrResultId', existing_result.id,
      'resultSha256', existing_result.result_sha256,
      'confidence', existing_result.confidence,
      'status', 'completed'
    );
  end if;

  if source_event.status <> 'publishing'::public.runtime_event_status
     or source_event.locked_by is distinct from
       public.complete_clinical_ocr.worker_id
     or source_event.lease_token is distinct from
       public.complete_clinical_ocr.lease_token
     or source_event.lease_expires_at <= now()
  then
    raise exception 'stale or invalid OCR worker lease'
      using errcode = '40001';
  end if;

  if jsonb_typeof(public.complete_clinical_ocr.result) <> 'object'
     or jsonb_typeof(public.complete_clinical_ocr.result->'text') <> 'string'
     or char_length(public.complete_clinical_ocr.result->>'text')
       not between 1 and 200000
     or jsonb_typeof(public.complete_clinical_ocr.result->'pageCount')
       <> 'number'
     or (public.complete_clinical_ocr.result->>'pageCount')::integer
       not between 1 and 50
     or jsonb_typeof(public.complete_clinical_ocr.result->'confidence')
       <> 'number'
     or (public.complete_clinical_ocr.result->>'confidence')::numeric
       not between 0 and 1
     or char_length(btrim(
       public.complete_clinical_ocr.result->>'provider'
     )) not between 1 and 100
     or char_length(btrim(
       public.complete_clinical_ocr.result->>'model'
     )) not between 1 and 160
  then
    raise exception 'OCR provider result violates the stage contract'
      using errcode = '22023';
  end if;

  numeric_confidence :=
    (public.complete_clinical_ocr.result->>'confidence')::numeric;
  result_hash := encode(
    public.digest(
      convert_to(public.complete_clinical_ocr.result::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select
    extraction.id as extraction_id,
    extraction.organization_id,
    extraction.prescription_id,
    extraction.pipeline_workflow_run_id as pipeline_id,
    prescription.patient_id,
    file.id as file_id,
    stage_run.id as workflow_id
  into strict context_row
  from public.prescription_extractions extraction
  join public.prescriptions prescription
    on prescription.id = extraction.prescription_id
   and prescription.organization_id = extraction.organization_id
  join public.prescription_files file
    on file.id = (source_event.payload->>'fileId')::uuid
   and file.organization_id = extraction.organization_id
   and file.prescription_id = extraction.prescription_id
  join public.workflow_runs stage_run
    on stage_run.id = (source_event.payload->>'workflowId')::uuid
   and stage_run.organization_id = extraction.organization_id
   and stage_run.parent_workflow_run_id =
     extraction.pipeline_workflow_run_id
  where extraction.id = (source_event.payload->>'extractionId')::uuid
    and extraction.organization_id = source_event.organization_id
    and extraction.pipeline_workflow_run_id =
      (source_event.payload->>'pipelineId')::uuid;

  insert into public.prescription_ocr_results (
    organization_id, prescription_id, extraction_id, prescription_file_id,
    workflow_run_id, provider, model, page_count, confidence,
    extracted_text, result_sha256
  ) values (
    context_row.organization_id,
    context_row.prescription_id,
    context_row.extraction_id,
    context_row.file_id,
    context_row.workflow_id,
    btrim(public.complete_clinical_ocr.result->>'provider'),
    btrim(public.complete_clinical_ocr.result->>'model'),
    (public.complete_clinical_ocr.result->>'pageCount')::integer,
    numeric_confidence,
    public.complete_clinical_ocr.result->>'text',
    result_hash
  )
  returning id into created_ocr_result_id;

  update public.prescription_extractions
  set provider = btrim(public.complete_clinical_ocr.result->>'provider'),
      model = btrim(public.complete_clinical_ocr.result->>'model')
  where id = context_row.extraction_id;

  parsing_workflow_id := public._ensure_clinical_stage_run(
    context_row.extraction_id,
    'parsing'
  );

  update public.workflow_runs
  set status = 'completed',
      current_step = 'completed',
      output_reference = jsonb_build_object(
        'ocrResultId', created_ocr_result_id,
        'resultSha256', result_hash,
        'confidence', numeric_confidence
      ),
      completed_at = now()
  where id = context_row.workflow_id
    and organization_id = context_row.organization_id;

  update public.workflow_runs
  set status = 'running',
      previous_step = 'ocr',
      current_step = 'parsing',
      next_step = 'clinical_validation',
      output_reference = coalesce(output_reference, '{}'::jsonb)
        || jsonb_build_object(
          'ocrResultId', created_ocr_result_id,
          'ocrResultSha256', result_hash,
          'confidence', numeric_confidence
        )
  where id = context_row.pipeline_id
    and organization_id = context_row.organization_id;

  update public.runtime_outbox_events
  set status = 'published',
      published_at = now(),
      locked_at = null,
      locked_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null
  where id = source_event.id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    context_row.organization_id,
    context_row.workflow_id,
    'workflow.stage.completed.v1',
    'ocr',
    null,
    source_event.id::text || ':workflow-completed',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'ocrResultId', created_ocr_result_id,
      'resultSha256', result_hash,
      'confidence', numeric_confidence
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  update public.ai_runs
  set status = 'completed',
      provider = btrim(public.complete_clinical_ocr.result->>'provider'),
      model = btrim(public.complete_clinical_ocr.result->>'model'),
      output = jsonb_build_object(
        'ocrResultId', created_ocr_result_id,
        'resultSha256', result_hash
      ),
      overall_confidence = numeric_confidence,
      completed_at = now(),
      error_code = null
  where organization_id = context_row.organization_id
    and idempotency_key = 'clinical-stage:' || source_event.id::text
  returning id into target_ai_run_id;

  insert into public.ai_audit_events (
    organization_id, ai_run_id, event_type, actor_id, idempotency_key,
    metadata
  ) values (
    context_row.organization_id,
    target_ai_run_id,
    'AI.StageCompleted',
    null,
    source_event.id::text || ':ai-completed',
    jsonb_build_object(
      'stage', 'ocr',
      'pipelineId', context_row.pipeline_id,
      'workflowId', context_row.workflow_id,
      'resultSha256', result_hash,
      'confidence', numeric_confidence
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values (
    context_row.organization_id,
    'prescription.ocr.completed.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', context_row.workflow_id,
      'ocrResultId', created_ocr_result_id,
      'resultSha256', result_hash,
      'confidence', numeric_confidence
    ),
    source_event.correlation_id,
    source_event.request_id,
    context_row.workflow_id::text,
    source_event.idempotency_key || ':ocr-completed'
  )
  on conflict (organization_id, idempotency_key) do nothing;

  if numeric_confidence < 0.85 then
    insert into public.runtime_outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id, payload,
      correlation_id, request_id, workflow_id, idempotency_key
    ) values (
      context_row.organization_id,
      'prescription.ocr.low-confidence.v1',
      'prescription',
      context_row.prescription_id::text,
      jsonb_build_object(
        'tenantId', context_row.organization_id,
        'prescriptionId', context_row.prescription_id,
        'extractionId', context_row.extraction_id,
        'pipelineId', context_row.pipeline_id,
        'workflowId', context_row.workflow_id,
        'ocrResultId', created_ocr_result_id,
        'confidence', numeric_confidence
      ),
      source_event.correlation_id,
      source_event.request_id,
      context_row.workflow_id::text,
      source_event.idempotency_key || ':ocr-low-confidence'
    )
    on conflict (organization_id, idempotency_key) do nothing;
  end if;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values (
    context_row.organization_id,
    'prescription.queued-for-parsing.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', parsing_workflow_id,
      'fileId', context_row.file_id,
      'ocrResultId', created_ocr_result_id
    ),
    source_event.correlation_id,
    source_event.request_id,
    parsing_workflow_id::text,
    source_event.idempotency_key || ':queued-for-parsing'
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    context_row.organization_id,
    'clinical.pipeline.stage',
    'system',
    public.complete_clinical_ocr.worker_id,
    'prescription',
    context_row.prescription_id::text,
    'ocr.complete',
    'success',
    source_event.correlation_id,
    source_event.request_id,
    source_event.id::text || ':audit-completed',
    context_row.workflow_id::text,
    'worker',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'extractionId', context_row.extraction_id,
      'ocrResultId', created_ocr_result_id,
      'resultSha256', result_hash
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'ocrResultId', created_ocr_result_id,
    'resultSha256', result_hash,
    'confidence', numeric_confidence,
    'nextWorkflowId', parsing_workflow_id,
    'status', 'completed'
  );
end;
$$;

revoke all on function public.complete_clinical_ocr(
  uuid, text, uuid, jsonb
) from public;
grant execute on function public.complete_clinical_ocr(
  uuid, text, uuid, jsonb
) to service_role;

create or replace function public.claim_clinical_pipeline_stage(
  worker_id text,
  lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_event record;
  context_row record;
  claimed_stage text;
  new_lease_token uuid := gen_random_uuid();
  claimed_attempt integer;
  claim_payload jsonb;
  target_ai_run_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'clinical pipeline claims require service_role'
      using errcode = '42501';
  end if;
  if char_length(btrim(
       public.claim_clinical_pipeline_stage.worker_id
     )) not between 3 and 160
     or public.claim_clinical_pipeline_stage.lease_seconds not between 15 and 300
  then
    raise exception 'invalid clinical worker lease request'
      using errcode = '22023';
  end if;

  select event.*
  into source_event
  from public.runtime_outbox_events event
  where event.event_type in (
      'prescription.queued-for-ocr.v1',
      'prescription.queued-for-parsing.v1',
      'prescription.queued-for-clinical-validation.v1'
    )
    and (
      event.retry_count < 5
      or (
        event.retry_count = 5
        and event.status = 'publishing'::public.runtime_event_status
        and event.lease_expires_at <= now()
      )
    )
    and (
      (
        event.status in (
          'pending'::public.runtime_event_status,
          'retrying'::public.runtime_event_status
        )
        and event.available_at <= now()
      )
      or
      (
        event.status = 'publishing'::public.runtime_event_status
        and event.lease_expires_at <= now()
      )
    )
  order by event.available_at, event.created_at, event.id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  claimed_stage := case source_event.event_type
    when 'prescription.queued-for-ocr.v1' then 'ocr'
    when 'prescription.queued-for-parsing.v1' then 'parsing'
    when 'prescription.queued-for-clinical-validation.v1'
      then 'clinical_validation'
  end;
  claimed_attempt := least(5, source_event.retry_count + 1);

  select
    extraction.id as extraction_id,
    extraction.organization_id,
    extraction.prescription_id,
    extraction.pipeline_workflow_run_id as pipeline_id,
    extraction.raw_output,
    prescription.patient_id,
    file.id as file_id,
    file.storage_bucket,
    file.storage_object_path,
    file.media_type,
    file.size_bytes,
    file.sha256,
    ocr.id as ocr_result_id,
    ocr.extracted_text,
    ocr.page_count,
    ocr.confidence as ocr_confidence,
    ocr.provider as ocr_provider,
    ocr.model as ocr_model,
    stage_run.id as stage_workflow_id
  into strict context_row
  from public.prescription_extractions extraction
  join public.prescriptions prescription
    on prescription.id = extraction.prescription_id
   and prescription.organization_id = extraction.organization_id
  join public.prescription_files file
    on file.id = (source_event.payload->>'fileId')::uuid
   and file.organization_id = extraction.organization_id
   and file.prescription_id = extraction.prescription_id
  join public.workflow_runs stage_run
    on stage_run.id = (source_event.payload->>'workflowId')::uuid
   and stage_run.organization_id = extraction.organization_id
   and stage_run.parent_workflow_run_id =
     extraction.pipeline_workflow_run_id
  left join public.prescription_ocr_results ocr
    on ocr.extraction_id = extraction.id
   and ocr.organization_id = extraction.organization_id
  where extraction.id = (source_event.payload->>'extractionId')::uuid
    and extraction.organization_id = source_event.organization_id
    and extraction.prescription_id = source_event.aggregate_id::uuid
    and extraction.pipeline_workflow_run_id =
      (source_event.payload->>'pipelineId')::uuid;

  if claimed_stage in ('parsing', 'clinical_validation')
     and context_row.ocr_result_id is null
  then
    raise exception 'clinical stage is missing immutable OCR evidence';
  end if;
  if claimed_stage = 'clinical_validation'
     and context_row.raw_output is null
  then
    raise exception 'clinical validation is missing structured extraction';
  end if;

  update public.runtime_outbox_events
  set status = 'publishing',
      locked_at = now(),
      locked_by = public.claim_clinical_pipeline_stage.worker_id,
      lease_token = new_lease_token,
      lease_expires_at = now() + make_interval(
        secs => public.claim_clinical_pipeline_stage.lease_seconds
      ),
      retry_count = claimed_attempt,
      last_error_code = null
  where id = source_event.id;

  update public.prescription_extractions
  set status = 'processing',
      started_at = coalesce(started_at, now()),
      completed_at = null,
      failure_code = null,
      failure_detail = null
  where id = context_row.extraction_id;

  update public.prescriptions
  set status = 'extracting'
  where id = context_row.prescription_id
    and organization_id = context_row.organization_id
    and status = 'received';

  update public.workflow_runs
  set status = 'running',
      current_step = claimed_stage,
      started_at = coalesce(started_at, now()),
      completed_at = null,
      attempt_count = claimed_attempt
  where id = context_row.stage_workflow_id
    and organization_id = context_row.organization_id;

  update public.workflow_runs
  set status = 'running',
      current_step = claimed_stage,
      started_at = coalesce(started_at, now()),
      completed_at = null,
      attempt_count = attempt_count + 1
  where id = context_row.pipeline_id
    and organization_id = context_row.organization_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    context_row.organization_id,
    context_row.stage_workflow_id,
    'workflow.stage.claimed.v1',
    claimed_stage,
    null,
    source_event.id::text || ':claim:' || claimed_attempt::text,
    jsonb_build_object(
      'sourceEventId', source_event.id,
      'pipelineId', context_row.pipeline_id,
      'attempt', claimed_attempt,
      'workerId', public.claim_clinical_pipeline_stage.worker_id
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  if claimed_stage in ('ocr', 'parsing') then
    insert into public.ai_runs (
      organization_id, prescription_id, agent_name, status, prompt_version,
      input_reference, idempotency_key, correlation_id, started_at
    ) values (
      context_row.organization_id,
      context_row.prescription_id,
      'prescription_reader',
      'running',
      'ML-ARC-006:v1',
      jsonb_build_object(
        'pipelineId', context_row.pipeline_id,
        'workflowId', context_row.stage_workflow_id,
        'extractionId', context_row.extraction_id,
        'stage', claimed_stage
      ),
      'clinical-stage:' || source_event.id::text,
      source_event.correlation_id,
      now()
    )
    on conflict (organization_id, idempotency_key) do update
    set status = 'running',
        error_code = null,
        started_at = now(),
        completed_at = null,
        output = null
    returning id into target_ai_run_id;

    insert into public.ai_audit_events (
      organization_id, ai_run_id, event_type, actor_id, idempotency_key,
      metadata
    ) values (
      context_row.organization_id,
      target_ai_run_id,
      'AI.StageClaimed',
      null,
      source_event.id::text || ':ai-claimed:' || claimed_attempt::text,
      jsonb_build_object(
        'stage', claimed_stage,
        'attempt', claimed_attempt,
        'pipelineId', context_row.pipeline_id,
        'workflowId', context_row.stage_workflow_id
      )
    )
    on conflict (organization_id, idempotency_key) do nothing;
  end if;

  claim_payload := jsonb_build_object(
    'stage', claimed_stage,
    'sourceEventId', source_event.id,
    'extractionId', context_row.extraction_id,
    'pipelineId', context_row.pipeline_id,
    'workflowId', context_row.stage_workflow_id,
    'tenantId', context_row.organization_id,
    'patientId', context_row.patient_id,
    'prescriptionId', context_row.prescription_id,
    'correlationId', source_event.correlation_id,
    'attempt', claimed_attempt,
    'workerId', public.claim_clinical_pipeline_stage.worker_id,
    'leaseToken', new_lease_token
  );

  if claimed_stage = 'ocr' then
    claim_payload := claim_payload || jsonb_build_object(
      'source',
      jsonb_build_object(
        'bucket', context_row.storage_bucket,
        'path', context_row.storage_object_path,
        'mediaType', context_row.media_type,
        'sizeBytes', context_row.size_bytes,
        'sha256', context_row.sha256
      )
    );
  elsif claimed_stage = 'parsing' then
    claim_payload := claim_payload || jsonb_build_object(
      'ocr',
      jsonb_build_object(
        'text', context_row.extracted_text,
        'pageCount', context_row.page_count,
        'confidence', context_row.ocr_confidence,
        'provider', context_row.ocr_provider,
        'model', context_row.ocr_model
      )
    );
  else
    claim_payload := claim_payload || jsonb_build_object(
      'ocr',
      jsonb_build_object(
        'text', context_row.extracted_text,
        'pageCount', context_row.page_count,
        'confidence', context_row.ocr_confidence,
        'provider', context_row.ocr_provider,
        'model', context_row.ocr_model
      ),
      'extraction', context_row.raw_output
    );
  end if;

  return claim_payload;
end;
$$;

revoke all on function public.claim_clinical_pipeline_stage(text, integer)
  from public;
grant execute on function public.claim_clinical_pipeline_stage(text, integer)
  to service_role;

revoke all on function public._ensure_clinical_workflow_definitions(uuid, uuid)
  from public;

create or replace function public._ensure_clinical_stage_run(
  target_extraction_id uuid,
  target_stage text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  target_definition_name text;
  target_previous_step text;
  target_next_step text;
  target_definition_id uuid;
  target_workflow_run_id uuid;
begin
  if target_stage not in (
    'ocr', 'parsing', 'clinical_validation', 'pharmacist_review'
  ) then
    raise exception 'unsupported clinical pipeline stage';
  end if;

  select
    extraction.organization_id,
    extraction.prescription_id,
    extraction.pipeline_workflow_run_id,
    coalesce(
      nullif(extraction.correlation_id, ''),
      'clinical-pipeline:' || extraction.id::text
    ) as correlation_id,
    prescription.patient_id,
    prescription.uploaded_by
  into strict context_row
  from public.prescription_extractions extraction
  join public.prescriptions prescription
    on prescription.id = extraction.prescription_id
   and prescription.organization_id = extraction.organization_id
  where extraction.id = target_extraction_id;

  if context_row.pipeline_workflow_run_id is null then
    raise exception 'clinical pipeline has not been initialized';
  end if;

  target_definition_name := case target_stage
    when 'ocr' then 'ML-WF-002'
    when 'parsing' then 'ML-WF-003'
    when 'clinical_validation' then 'ML-WF-004'
    when 'pharmacist_review' then 'ML-WF-005'
  end;
  target_previous_step := case target_stage
    when 'ocr' then null
    when 'parsing' then 'ocr'
    when 'clinical_validation' then 'parsing'
    when 'pharmacist_review' then 'clinical_validation'
  end;
  target_next_step := case target_stage
    when 'ocr' then 'parsing'
    when 'parsing' then 'clinical_validation'
    when 'clinical_validation' then 'pharmacist_review'
    when 'pharmacist_review' then null
  end;

  perform public._ensure_clinical_workflow_definitions(
    context_row.organization_id,
    context_row.uploaded_by
  );

  select id into strict target_definition_id
  from public.workflow_definitions
  where organization_id = context_row.organization_id
    and name = target_definition_name
    and version = 1;

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, parent_workflow_run_id,
    status, subject_type, subject_reference, input_reference,
    current_step, previous_step, next_step, idempotency_key,
    correlation_id, created_by
  ) values (
    context_row.organization_id,
    target_definition_id,
    context_row.pipeline_workflow_run_id,
    case
      when target_stage = 'pharmacist_review'
        then 'waiting'::public.workflow_run_status
      else 'queued'::public.workflow_run_status
    end,
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'prescriptionId', context_row.prescription_id,
      'extractionId', target_extraction_id,
      'pipelineId', context_row.pipeline_workflow_run_id
    ),
    case
      when target_stage = 'pharmacist_review' then 'awaiting_pharmacist'
      else 'queued'
    end,
    target_previous_step,
    target_next_step,
    target_definition_name || ':' || target_extraction_id::text,
    context_row.correlation_id,
    context_row.uploaded_by
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into target_workflow_run_id;

  if target_workflow_run_id is null then
    select id into strict target_workflow_run_id
    from public.workflow_runs
    where organization_id = context_row.organization_id
      and idempotency_key =
        target_definition_name || ':' || target_extraction_id::text;
  end if;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    context_row.organization_id,
    target_workflow_run_id,
    'workflow.stage.queued.v1',
    target_stage,
    null,
    target_definition_name || ':' || target_extraction_id::text || ':queued',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_workflow_run_id,
      'extractionId', target_extraction_id,
      'capabilityId',
      case
        when target_stage = 'pharmacist_review' then 'ML-CAP-007'
        else 'ML-CAP-006'
      end
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return target_workflow_run_id;
end;
$$;

revoke all on function public._ensure_clinical_stage_run(uuid, text)
  from public;

create or replace function public._ensure_clinical_pipeline(
  target_extraction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
  target_definition_id uuid;
  target_pipeline_id uuid;
  target_ocr_workflow_id uuid;
begin
  select
    extraction.organization_id,
    extraction.prescription_id,
    extraction.pipeline_workflow_run_id,
    coalesce(
      nullif(extraction.correlation_id, ''),
      'clinical-pipeline:' || extraction.id::text
    ) as correlation_id,
    prescription.patient_id,
    prescription.uploaded_by,
    file.id as file_id
  into strict context_row
  from public.prescription_extractions extraction
  join public.prescriptions prescription
    on prescription.id = extraction.prescription_id
   and prescription.organization_id = extraction.organization_id
  join lateral (
    select prescription_file.id
    from public.prescription_files prescription_file
    where prescription_file.organization_id = extraction.organization_id
      and prescription_file.prescription_id = extraction.prescription_id
    order by prescription_file.version desc
    limit 1
  ) file on true
  where extraction.id = target_extraction_id
  for update of extraction;

  perform public._ensure_clinical_workflow_definitions(
    context_row.organization_id,
    context_row.uploaded_by
  );

  if context_row.pipeline_workflow_run_id is null then
    select id into strict target_definition_id
    from public.workflow_definitions
    where organization_id = context_row.organization_id
      and name = 'ML-CPP-001'
      and version = 1;

    insert into public.workflow_runs (
      organization_id, workflow_definition_id, status, subject_type,
      subject_reference, input_reference, output_reference, current_step,
      previous_step, next_step, idempotency_key, correlation_id, created_by
    ) values (
      context_row.organization_id,
      target_definition_id,
      'queued',
      'prescription',
      context_row.prescription_id::text,
      jsonb_build_object(
        'prescriptionId', context_row.prescription_id,
        'extractionId', target_extraction_id,
        'fileId', context_row.file_id
      ),
      jsonb_build_object('confidence', null),
      'ocr',
      null,
      'parsing',
      'ML-CPP-001:' || target_extraction_id::text,
      context_row.correlation_id,
      context_row.uploaded_by
    )
    on conflict (organization_id, idempotency_key) do nothing
    returning id into target_pipeline_id;

    if target_pipeline_id is null then
      select id into strict target_pipeline_id
      from public.workflow_runs
      where organization_id = context_row.organization_id
        and idempotency_key = 'ML-CPP-001:' || target_extraction_id::text;
    end if;

    update public.prescription_extractions
    set pipeline_workflow_run_id = target_pipeline_id
    where id = target_extraction_id
      and pipeline_workflow_run_id is null;

    insert into public.workflow_run_events (
      organization_id, workflow_run_id, event_type, step_name, actor_id,
      idempotency_key, detail
    ) values (
      context_row.organization_id,
      target_pipeline_id,
      'pipeline.initialized.v1',
      'ocr',
      null,
      'ML-CPP-001:' || target_extraction_id::text || ':initialized',
      jsonb_build_object(
        'pipelineCode', 'ML-CPP-001',
        'capabilityId', 'ML-CAP-006',
        'extractionId', target_extraction_id,
        'fileId', context_row.file_id
      )
    )
    on conflict (organization_id, idempotency_key) do nothing;
  else
    target_pipeline_id := context_row.pipeline_workflow_run_id;
  end if;

  target_ocr_workflow_id := public._ensure_clinical_stage_run(
    target_extraction_id,
    'ocr'
  );

  return jsonb_build_object(
    'pipelineId', target_pipeline_id,
    'workflowId', target_ocr_workflow_id,
    'fileId', context_row.file_id
  );
end;
$$;

revoke all on function public._ensure_clinical_pipeline(uuid)
  from public;

create or replace function public.initialize_clinical_pipeline_from_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.prescription_files file
    where file.organization_id = new.organization_id
      and file.prescription_id = new.prescription_id
  ) then
    perform public._ensure_clinical_pipeline(new.id);
  end if;
  return new;
end;
$$;

create trigger prescription_extractions_initialize_pipeline
after insert on public.prescription_extractions
for each row execute function public.initialize_clinical_pipeline_from_extraction();

-- ML-WF-001 v1 used the provisional capability identifier ML-CAP-003.
-- Preserve that immutable history, retire the definition for new runs and
-- publish a corrected v2 definition under the canonical ML-CAP-006 mapping.
update public.workflow_definitions
set is_active = false
where name = 'ML-WF-001'
  and version = 1
  and is_active;

insert into public.workflow_definitions (
  organization_id, name, version, definition, definition_sha256,
  is_active, created_by
)
select
  definition.organization_id,
  'ML-WF-001',
  2,
  '{"capabilityId":"ML-CAP-006","steps":["initialized","validated","stored","queued_for_ocr","completed"],"version":2}'::jsonb,
  encode(
    public.digest(
      convert_to(
        '{"capabilityId":"ML-CAP-006","steps":["initialized","validated","stored","queued_for_ocr","completed"],"version":2}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  true,
  definition.created_by
from public.workflow_definitions definition
where definition.name = 'ML-WF-001'
  and definition.version = 1
on conflict (organization_id, name, version) do nothing;

insert into public.workflow_run_events (
  organization_id, workflow_run_id, event_type, step_name, actor_id,
  idempotency_key, detail
)
select
  run.organization_id,
  run.id,
  'workflow.metadata.corrected.v1',
  'completed',
  null,
  run.idempotency_key || ':capability-corrected',
  jsonb_build_object(
    'previousCapabilityId', 'ML-CAP-003',
    'capabilityId', 'ML-CAP-006',
    'correctionMigration', '202607300017'
  )
from public.workflow_runs run
join public.workflow_definitions definition
  on definition.id = run.workflow_definition_id
 and definition.organization_id = run.organization_id
where definition.name = 'ML-WF-001'
  and definition.version = 1
on conflict (organization_id, idempotency_key) do nothing;

-- Existing intake rows predate the parent pipeline link. Initializing them is
-- deterministic and idempotent because workflow-run idempotency keys are
-- derived from the immutable extraction identifier.
do $$
declare
  extraction_row record;
begin
  for extraction_row in
    select extraction.id
    from public.prescription_extractions extraction
    where extraction.pipeline_workflow_run_id is null
      and exists (
        select 1
        from public.prescription_files file
        where file.organization_id = extraction.organization_id
          and file.prescription_id = extraction.prescription_id
      )
    order by extraction.created_at, extraction.id
  loop
    perform public._ensure_clinical_pipeline(extraction_row.id);
  end loop;
end;
$$;

create or replace function public.enforce_prescription_outbox_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_extraction_id uuid;
  pipeline_context jsonb;
begin
  if new.event_type = 'prescription.queued-for-ocr.v1'
     and new.status in (
       'pending'::public.runtime_event_status,
       'retrying'::public.runtime_event_status,
       'publishing'::public.runtime_event_status
     )
  then
    if new.payload ? 'extractionId' then
      select extraction.id into strict target_extraction_id
      from public.prescription_extractions extraction
      where extraction.id = (new.payload->>'extractionId')::uuid
        and extraction.organization_id = new.organization_id
        and extraction.prescription_id = new.aggregate_id::uuid;
    else
      select extraction.id into strict target_extraction_id
      from public.prescription_extractions extraction
      where extraction.organization_id = new.organization_id
        and extraction.prescription_id = new.aggregate_id::uuid
      order by extraction.created_at desc
      limit 1;
    end if;

    pipeline_context := public._ensure_clinical_pipeline(
      target_extraction_id
    );
    new.payload := jsonb_build_object(
      'tenantId', new.organization_id,
      'prescriptionId', new.aggregate_id::uuid,
      'extractionId', target_extraction_id,
      'pipelineId', pipeline_context->>'pipelineId',
      'workflowId', pipeline_context->>'workflowId',
      'fileId', pipeline_context->>'fileId'
    );
    new.workflow_id := pipeline_context->>'workflowId';
  end if;

  if new.event_type like 'prescription.%'
     and new.payload::text ~* '"(patientId|patientName|text|findings|rationale|rawOutput|extraction)"[[:space:]]*:'
  then
    raise exception 'prescription outbox payload contains prohibited PHI';
  end if;

  return new;
end;
$$;

create trigger runtime_outbox_prescription_boundary
before insert or update of event_type, payload
on public.runtime_outbox_events
for each row execute function public.enforce_prescription_outbox_boundary();

-- This is a one-time forward correction of legacy, not-yet-enriched intake
-- events. The trigger supplies the durable extraction/file/pipeline references.
update public.runtime_outbox_events
set payload = payload - 'patientId'
where event_type like 'prescription.%'
  and payload ? 'patientId';

update public.runtime_outbox_events
set payload = payload
where event_type = 'prescription.queued-for-ocr.v1'
  and status in ('pending', 'retrying', 'publishing');

-- A legacy dispatcher may already have marked the pre-PI-1 queue event as
-- published even though no OCR worker existed. Preserve that event and append
-- one deterministic, claimable backfill work item instead of reopening history.
insert into public.runtime_outbox_events (
  organization_id, event_type, aggregate_type, aggregate_id, payload,
  correlation_id, request_id, idempotency_key
)
select
  extraction.organization_id,
  'prescription.queued-for-ocr.v1',
  'prescription',
  extraction.prescription_id::text,
  jsonb_build_object(
    'tenantId', extraction.organization_id,
    'prescriptionId', extraction.prescription_id,
    'extractionId', extraction.id,
    'fileId', file.id
  ),
  coalesce(
    nullif(extraction.correlation_id, ''),
    'pi1-backfill:' || extraction.id::text
  ),
  'pi1-backfill:' || extraction.id::text,
  'pi1-backfill:' || extraction.id::text || ':queued-for-ocr'
from public.prescription_extractions extraction
join lateral (
  select prescription_file.id
  from public.prescription_files prescription_file
  where prescription_file.organization_id = extraction.organization_id
    and prescription_file.prescription_id = extraction.prescription_id
  order by prescription_file.version desc
  limit 1
) file on true
where extraction.pipeline_workflow_run_id is not null
  and extraction.status in ('queued', 'processing')
  and not exists (
    select 1
    from public.prescription_ocr_results ocr
    where ocr.extraction_id = extraction.id
  )
  and not exists (
    select 1
    from public.runtime_outbox_events event
    where event.organization_id = extraction.organization_id
      and event.event_type = 'prescription.queued-for-ocr.v1'
      and event.payload->>'extractionId' = extraction.id::text
      and event.status in ('pending', 'retrying', 'publishing')
  )
on conflict (organization_id, idempotency_key) do nothing;

-- Replace the intake command forward-only. The original retry query joined
-- every workflow run for the prescription, which becomes ambiguous as soon as
-- PI-1 child workflows exist. The corrected command resolves only the exact
-- ML-WF-001 idempotency key and emits the canonical capability metadata.
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
set search_path = ''
as $$
declare
  created_prescription_id uuid;
  created_file_id uuid;
  created_extraction_id uuid;
  definition_id uuid;
  created_workflow_id uuid;
  existing_id uuid;
begin
  if auth.uid() is null
    or auth.uid() <> target_patient_id
    or auth.uid() <> target_uploaded_by
    or not public.is_organization_member(target_organization_id)
    or target_bucket <> 'prescriptions-private'
    or target_path not like
      target_organization_id::text || '/' || target_patient_id::text || '/%'
    or btrim(target_idempotency_key) = ''
  then
    raise exception 'invalid prescription intake context' using errcode = '42501';
  end if;

  select (event.payload->>'prescriptionId')::uuid into existing_id
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':uploaded';

  if existing_id is not null then
    if not exists (
      select 1
      from public.prescriptions prescription
      join public.prescription_files file
        on file.prescription_id = prescription.id
       and file.organization_id = prescription.organization_id
      where prescription.id = existing_id
        and prescription.organization_id = target_organization_id
        and file.storage_object_path = target_path
        and file.sha256 = target_sha256
    ) then
      raise exception
        'idempotency key was already used for another prescription'
        using errcode = '23505';
    end if;

    return query
      select prescription.id, prescription.status, run.id
      from public.prescriptions prescription
      join public.workflow_runs run
        on run.organization_id = prescription.organization_id
       and run.subject_type = 'prescription'
       and run.subject_reference = prescription.id::text
       and run.idempotency_key = target_idempotency_key
      join public.workflow_definitions definition
        on definition.id = run.workflow_definition_id
       and definition.organization_id = run.organization_id
       and definition.name = 'ML-WF-001'
      where prescription.id = existing_id
        and prescription.organization_id = target_organization_id;
    return;
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = target_bucket
      and object.name = target_path
  ) then
    raise exception 'prescription object does not exist' using errcode = '23503';
  end if;

  update public.workflow_definitions
  set is_active = false
  where organization_id = target_organization_id
    and name = 'ML-WF-001'
    and version < 2
    and is_active;

  insert into public.workflow_definitions (
    organization_id, name, version, definition, definition_sha256,
    is_active, created_by
  ) values (
    target_organization_id,
    'ML-WF-001',
    2,
    '{"capabilityId":"ML-CAP-006","steps":["initialized","validated","stored","queued_for_ocr","completed"],"version":2}'::jsonb,
    encode(
      public.digest(
        convert_to(
          '{"capabilityId":"ML-CAP-006","steps":["initialized","validated","stored","queued_for_ocr","completed"],"version":2}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    true,
    auth.uid()
  )
  on conflict (organization_id, name, version) do nothing;

  select id into strict definition_id
  from public.workflow_definitions
  where organization_id = target_organization_id
    and name = 'ML-WF-001'
    and version = 2;

  insert into public.prescriptions (
    organization_id, patient_id, source, status, storage_bucket,
    storage_object_path, uploaded_by
  ) values (
    target_organization_id, target_patient_id, 'upload', 'received',
    target_bucket, target_path, target_uploaded_by
  )
  returning id into created_prescription_id;

  insert into public.prescription_files (
    organization_id, prescription_id, storage_bucket, storage_object_path,
    media_type, size_bytes, sha256, scan_status, scanner
  ) values (
    target_organization_id, created_prescription_id, target_bucket, target_path,
    target_media_type, target_size_bytes, target_sha256, 'clean', target_scanner
  )
  returning id into created_file_id;

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, status, subject_type,
    subject_reference, input_reference, output_reference, current_step,
    idempotency_key, correlation_id, started_at, completed_at, created_by
  ) values (
    target_organization_id, definition_id, 'completed', 'prescription',
    created_prescription_id::text,
    jsonb_build_object('patientId', target_patient_id),
    jsonb_build_object(
      'prescriptionId', created_prescription_id,
      'fileId', created_file_id
    ),
    'completed', target_idempotency_key, target_correlation_id,
    now(), now(), auth.uid()
  )
  returning id into created_workflow_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  )
  select
    target_organization_id,
    created_workflow_id,
    stage.event_type,
    stage.step_name,
    auth.uid(),
    target_idempotency_key || stage.key_suffix,
    jsonb_build_object(
      'workflowVersion', 2,
      'capabilityId', 'ML-CAP-006'
    )
  from (
    values
      ('workflow.started.v1', 'initialized', ':workflow:started'),
      ('workflow.step.completed.v1', 'validated', ':workflow:validated'),
      ('workflow.step.completed.v1', 'stored', ':workflow:stored'),
      ('workflow.step.completed.v1', 'queued_for_ocr', ':workflow:queued'),
      ('workflow.completed.v1', 'completed', ':workflow:completed')
  ) as stage(event_type, step_name, key_suffix);

  insert into public.prescription_extractions (
    organization_id, prescription_id, status, correlation_id
  ) values (
    target_organization_id,
    created_prescription_id,
    'queued',
    target_correlation_id
  )
  returning id into created_extraction_id;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values
  (
    target_organization_id,
    'prescription.upload.started.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'workflowId', created_workflow_id
    ),
    target_correlation_id,
    target_request_id,
    created_workflow_id::text,
    target_idempotency_key || ':started'
  ),
  (
    target_organization_id,
    'prescription.uploaded.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'extractionId', created_extraction_id,
      'fileId', created_file_id
    ),
    target_correlation_id,
    target_request_id,
    created_workflow_id::text,
    target_idempotency_key || ':uploaded'
  ),
  (
    target_organization_id,
    'prescription.validated.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'scanStatus', 'clean'
    ),
    target_correlation_id,
    target_request_id,
    created_workflow_id::text,
    target_idempotency_key || ':validated'
  ),
  (
    target_organization_id,
    'prescription.stored.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'fileId', created_file_id
    ),
    target_correlation_id,
    target_request_id,
    created_workflow_id::text,
    target_idempotency_key || ':stored'
  ),
  (
    target_organization_id,
    'prescription.queued-for-ocr.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'extractionId', created_extraction_id,
      'fileId', created_file_id
    ),
    target_correlation_id,
    target_request_id,
    created_workflow_id::text,
    target_idempotency_key || ':queued'
  ),
  (
    target_organization_id,
    'prescription.upload.completed.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'workflowId', created_workflow_id
    ),
    target_correlation_id,
    target_request_id,
    created_workflow_id::text,
    target_idempotency_key || ':completed'
  );

  return query
    select
      created_prescription_id,
      'received'::public.prescription_status,
      created_workflow_id;
end;
$$;

create or replace function public.complete_clinical_parsing(
  source_event_id uuid,
  worker_id text,
  lease_token uuid,
  extraction jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_event record;
  context_row record;
  item_row record;
  field_row record;
  created_prescription_item_id uuid;
  validation_workflow_id uuid;
  target_ai_run_id uuid;
  extraction_hash text;
  parsed_confidence numeric;
  item_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'clinical pipeline completion requires service_role'
      using errcode = '42501';
  end if;

  select event.* into strict source_event
  from public.runtime_outbox_events event
  where event.id = public.complete_clinical_parsing.source_event_id
  for update;

  if source_event.event_type <> 'prescription.queued-for-parsing.v1' then
    raise exception 'source event is not a parsing work item'
      using errcode = '22023';
  end if;

  if source_event.status = 'published'::public.runtime_event_status then
    select extraction_row.raw_output, extraction_row.overall_confidence
    into strict context_row
    from public.prescription_extractions extraction_row
    where extraction_row.id =
      (source_event.payload->>'extractionId')::uuid;
    if encode(
         public.digest(
           convert_to(context_row.raw_output::text, 'UTF8'),
           'sha256'
         ),
         'hex'
       ) is distinct from encode(
         public.digest(
           convert_to(
             public.complete_clinical_parsing.extraction::text,
             'UTF8'
           ),
           'sha256'
         ),
         'hex'
       )
    then
      raise exception 'parsing completion replay payload does not match'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'extractionId', (source_event.payload->>'extractionId')::uuid,
      'extractionSha256', encode(
        public.digest(
          convert_to(context_row.raw_output::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      'confidence', context_row.overall_confidence,
      'status', 'completed'
    );
  end if;

  if source_event.status <> 'publishing'::public.runtime_event_status
     or source_event.locked_by is distinct from
       public.complete_clinical_parsing.worker_id
     or source_event.lease_token is distinct from
       public.complete_clinical_parsing.lease_token
     or source_event.lease_expires_at <= now()
  then
    raise exception 'stale or invalid parsing worker lease'
      using errcode = '40001';
  end if;

  if jsonb_typeof(public.complete_clinical_parsing.extraction) <> 'object'
     or jsonb_typeof(
       public.complete_clinical_parsing.extraction->'items'
     ) <> 'array'
     or jsonb_array_length(
       public.complete_clinical_parsing.extraction->'items'
     ) not between 1 and 30
     or jsonb_typeof(
       public.complete_clinical_parsing.extraction->'overallConfidence'
     ) <> 'number'
     or (
       public.complete_clinical_parsing.extraction->>'overallConfidence'
     )::numeric not between 0 and 1
     or (
       public.complete_clinical_parsing.extraction
       - array['patientName', 'prescriberName', 'items', 'overallConfidence']
     ) <> '{}'::jsonb
  then
    raise exception 'structured extraction violates the parsing contract'
      using errcode = '22023';
  end if;

  parsed_confidence := (
    public.complete_clinical_parsing.extraction->>'overallConfidence'
  )::numeric;
  item_count := jsonb_array_length(
    public.complete_clinical_parsing.extraction->'items'
  );
  extraction_hash := encode(
    public.digest(
      convert_to(
        public.complete_clinical_parsing.extraction::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select
    extraction_row.id as extraction_id,
    extraction_row.organization_id,
    extraction_row.prescription_id,
    extraction_row.pipeline_workflow_run_id as pipeline_id,
    prescription.patient_id,
    file.id as file_id,
    ocr.id as ocr_result_id,
    stage_run.id as workflow_id
  into strict context_row
  from public.prescription_extractions extraction_row
  join public.prescriptions prescription
    on prescription.id = extraction_row.prescription_id
   and prescription.organization_id = extraction_row.organization_id
  join public.prescription_files file
    on file.id = (source_event.payload->>'fileId')::uuid
   and file.organization_id = extraction_row.organization_id
   and file.prescription_id = extraction_row.prescription_id
  join public.prescription_ocr_results ocr
    on ocr.extraction_id = extraction_row.id
   and ocr.organization_id = extraction_row.organization_id
  join public.workflow_runs stage_run
    on stage_run.id = (source_event.payload->>'workflowId')::uuid
   and stage_run.organization_id = extraction_row.organization_id
   and stage_run.parent_workflow_run_id =
     extraction_row.pipeline_workflow_run_id
  where extraction_row.id =
      (source_event.payload->>'extractionId')::uuid
    and extraction_row.organization_id = source_event.organization_id
    and extraction_row.pipeline_workflow_run_id =
      (source_event.payload->>'pipelineId')::uuid;

  for field_row in
    select field.key, field.value
    from jsonb_each(
      public.complete_clinical_parsing.extraction
        - 'items'
        - 'overallConfidence'
    ) field
  loop
    if field_row.key not in ('patientName', 'prescriberName')
       or jsonb_typeof(field_row.value) <> 'object'
       or jsonb_typeof(field_row.value->'value') <> 'string'
       or char_length(field_row.value->>'value') not between 1 and 2000
       or jsonb_typeof(field_row.value->'confidence') <> 'number'
       or (field_row.value->>'confidence')::numeric not between 0 and 1
       or (
         field_row.value - array['value', 'confidence']
       ) <> '{}'::jsonb
    then
      raise exception 'invalid prescription header field'
        using errcode = '22023';
    end if;

    insert into public.prescription_extracted_fields (
      extraction_id, field_path, raw_value, normalized_value, confidence,
      needs_human_review
    ) values (
      context_row.extraction_id,
      field_row.key,
      field_row.value->>'value',
      to_jsonb(field_row.value->>'value'),
      (field_row.value->>'confidence')::numeric,
      (field_row.value->>'confidence')::numeric < 0.85
    );
  end loop;

  for item_row in
    select item.value, item.ordinality
    from jsonb_array_elements(
      public.complete_clinical_parsing.extraction->'items'
    ) with ordinality item(value, ordinality)
  loop
    if jsonb_typeof(item_row.value) <> 'object'
       or (
         item_row.value
         - array[
             'medicineName', 'strength', 'dosage', 'quantity', 'refills'
           ]
       ) <> '{}'::jsonb
       or not (
         item_row.value ? 'medicineName'
         and item_row.value ? 'strength'
         and item_row.value ? 'dosage'
       )
    then
      raise exception 'invalid structured prescription item'
        using errcode = '22023';
    end if;

    for field_row in
      select field.key, field.value
      from jsonb_each(item_row.value) field
    loop
      if jsonb_typeof(field_row.value) <> 'object'
         or jsonb_typeof(field_row.value->'value') <> 'string'
         or char_length(field_row.value->>'value') not between 1 and 2000
         or jsonb_typeof(field_row.value->'confidence') <> 'number'
         or (field_row.value->>'confidence')::numeric not between 0 and 1
         or (
           field_row.value - array['value', 'confidence']
         ) <> '{}'::jsonb
      then
        raise exception 'invalid extracted prescription field'
          using errcode = '22023';
      end if;
    end loop;

    insert into public.prescription_items (
      prescription_id, line_number, raw_medicine_text, strength, dosage
    ) values (
      context_row.prescription_id,
      item_row.ordinality::integer,
      item_row.value->'medicineName'->>'value',
      item_row.value->'strength'->>'value',
      item_row.value->'dosage'->>'value'
    )
    returning id into created_prescription_item_id;

    for field_row in
      select field.key, field.value
      from jsonb_each(item_row.value) field
    loop
      insert into public.prescription_extracted_fields (
        extraction_id, field_path, raw_value, normalized_value, confidence,
        needs_human_review
      ) values (
        context_row.extraction_id,
        'items.' || (item_row.ordinality - 1)::text || '.' || field_row.key,
        field_row.value->>'value',
        jsonb_build_object(
          'value', field_row.value->>'value',
          'prescriptionItemId', created_prescription_item_id
        ),
        (field_row.value->>'confidence')::numeric,
        (field_row.value->>'confidence')::numeric < 0.85
      );
    end loop;
  end loop;

  insert into public.prescription_extracted_fields (
    extraction_id, field_path, raw_value, normalized_value, confidence,
    needs_human_review
  ) values (
    context_row.extraction_id,
    'document.overallConfidence',
    null,
    to_jsonb(parsed_confidence),
    parsed_confidence,
    parsed_confidence < 0.85
  );

  update public.prescription_extractions
  set status = 'completed',
      raw_output = public.complete_clinical_parsing.extraction,
      overall_confidence = parsed_confidence,
      completed_at = now(),
      failure_code = null,
      failure_detail = null
  where id = context_row.extraction_id;

  validation_workflow_id := public._ensure_clinical_stage_run(
    context_row.extraction_id,
    'clinical_validation'
  );

  update public.workflow_runs
  set status = 'completed',
      current_step = 'completed',
      output_reference = jsonb_build_object(
        'extractionId', context_row.extraction_id,
        'extractionSha256', extraction_hash,
        'confidence', parsed_confidence,
        'itemCount', item_count
      ),
      completed_at = now()
  where id = context_row.workflow_id
    and organization_id = context_row.organization_id;

  update public.workflow_runs
  set status = 'running',
      previous_step = 'parsing',
      current_step = 'clinical_validation',
      next_step = 'pharmacist_review',
      output_reference = coalesce(output_reference, '{}'::jsonb)
        || jsonb_build_object(
          'extractionSha256', extraction_hash,
          'confidence', parsed_confidence,
          'itemCount', item_count
        )
  where id = context_row.pipeline_id
    and organization_id = context_row.organization_id;

  update public.runtime_outbox_events
  set status = 'published',
      published_at = now(),
      locked_at = null,
      locked_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null
  where id = source_event.id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    context_row.organization_id,
    context_row.workflow_id,
    'workflow.stage.completed.v1',
    'parsing',
    null,
    source_event.id::text || ':workflow-completed',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'extractionId', context_row.extraction_id,
      'extractionSha256', extraction_hash,
      'confidence', parsed_confidence,
      'itemCount', item_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  update public.ai_runs
  set status = 'completed',
      output = jsonb_build_object(
        'extractionId', context_row.extraction_id,
        'extractionSha256', extraction_hash,
        'itemCount', item_count
      ),
      overall_confidence = parsed_confidence,
      completed_at = now(),
      error_code = null
  where organization_id = context_row.organization_id
    and idempotency_key = 'clinical-stage:' || source_event.id::text
  returning id into target_ai_run_id;

  insert into public.ai_audit_events (
    organization_id, ai_run_id, event_type, actor_id, idempotency_key,
    metadata
  ) values (
    context_row.organization_id,
    target_ai_run_id,
    'AI.StageCompleted',
    null,
    source_event.id::text || ':ai-completed',
    jsonb_build_object(
      'stage', 'parsing',
      'pipelineId', context_row.pipeline_id,
      'workflowId', context_row.workflow_id,
      'extractionSha256', extraction_hash,
      'confidence', parsed_confidence,
      'itemCount', item_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values (
    context_row.organization_id,
    'prescription.parsed.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', context_row.workflow_id,
      'extractionSha256', extraction_hash,
      'confidence', parsed_confidence,
      'itemCount', item_count
    ),
    source_event.correlation_id,
    source_event.request_id,
    context_row.workflow_id::text,
    source_event.idempotency_key || ':parsed'
  )
  on conflict (organization_id, idempotency_key) do nothing;

  if parsed_confidence < 0.85
     or exists (
       select 1
       from public.prescription_extracted_fields field
       where field.extraction_id = context_row.extraction_id
         and field.needs_human_review
     )
  then
    insert into public.runtime_outbox_events (
      organization_id, event_type, aggregate_type, aggregate_id, payload,
      correlation_id, request_id, workflow_id, idempotency_key
    ) values (
      context_row.organization_id,
      'prescription.ambiguity-detected.v1',
      'prescription',
      context_row.prescription_id::text,
      jsonb_build_object(
        'tenantId', context_row.organization_id,
        'prescriptionId', context_row.prescription_id,
        'extractionId', context_row.extraction_id,
        'pipelineId', context_row.pipeline_id,
        'workflowId', context_row.workflow_id,
        'confidence', parsed_confidence
      ),
      source_event.correlation_id,
      source_event.request_id,
      context_row.workflow_id::text,
      source_event.idempotency_key || ':ambiguity'
    )
    on conflict (organization_id, idempotency_key) do nothing;
  end if;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values (
    context_row.organization_id,
    'prescription.queued-for-clinical-validation.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', validation_workflow_id,
      'fileId', context_row.file_id,
      'ocrResultId', context_row.ocr_result_id,
      'extractionSha256', extraction_hash,
      'confidence', parsed_confidence
    ),
    source_event.correlation_id,
    source_event.request_id,
    validation_workflow_id::text,
    source_event.idempotency_key || ':queued-for-clinical-validation'
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    context_row.organization_id,
    'clinical.pipeline.stage',
    'system',
    public.complete_clinical_parsing.worker_id,
    'prescription',
    context_row.prescription_id::text,
    'parsing.complete',
    'success',
    source_event.correlation_id,
    source_event.request_id,
    source_event.id::text || ':audit-completed',
    context_row.workflow_id::text,
    'worker',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'extractionId', context_row.extraction_id,
      'extractionSha256', extraction_hash,
      'itemCount', item_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'extractionId', context_row.extraction_id,
    'extractionSha256', extraction_hash,
    'confidence', parsed_confidence,
    'itemCount', item_count,
    'nextWorkflowId', validation_workflow_id,
    'status', 'completed'
  );
end;
$$;

revoke all on function public.complete_clinical_parsing(
  uuid, text, uuid, jsonb
) from public;
grant execute on function public.complete_clinical_parsing(
  uuid, text, uuid, jsonb
) to service_role;

create or replace function public.complete_clinical_validation(
  source_event_id uuid,
  worker_id text,
  lease_token uuid,
  findings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_event record;
  context_row record;
  finding_row record;
  existing_result record;
  review_workflow_id uuid;
  created_validation_id uuid;
  created_evidence_id uuid;
  evidence_document jsonb;
  evidence_hash text;
  finding_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'clinical pipeline completion requires service_role'
      using errcode = '42501';
  end if;

  select event.* into strict source_event
  from public.runtime_outbox_events event
  where event.id = public.complete_clinical_validation.source_event_id
  for update;

  if source_event.event_type <>
    'prescription.queued-for-clinical-validation.v1'
  then
    raise exception 'source event is not a clinical validation work item'
      using errcode = '22023';
  end if;

  if source_event.status = 'published'::public.runtime_event_status then
    select
      validation.id as validation_id,
      evidence.id as evidence_id,
      evidence.content_sha256,
      validation.workflow_run_id
    into strict existing_result
    from public.clinical_validations validation
    join public.clinical_evidence_packages evidence
      on evidence.validation_id = validation.id
     and evidence.organization_id = validation.organization_id
     and evidence.version = 1
    where validation.prescription_id = source_event.aggregate_id::uuid
      and validation.organization_id = source_event.organization_id
      and evidence.extraction_id =
        (source_event.payload->>'extractionId')::uuid
    order by evidence.version desc
    limit 1;
    if (
         select evidence->'validationFindings'
         from public.clinical_evidence_packages
         where id = existing_result.evidence_id
       ) is distinct from public.complete_clinical_validation.findings
    then
      raise exception 'validation completion replay payload does not match'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'validationId', existing_result.validation_id,
      'evidenceId', existing_result.evidence_id,
      'contentSha256', existing_result.content_sha256,
      'reviewWorkflowId', existing_result.workflow_run_id,
      'status', 'completed'
    );
  end if;

  if source_event.status <> 'publishing'::public.runtime_event_status
     or source_event.locked_by is distinct from
       public.complete_clinical_validation.worker_id
     or source_event.lease_token is distinct from
       public.complete_clinical_validation.lease_token
     or source_event.lease_expires_at <= now()
  then
    raise exception 'stale or invalid clinical validation worker lease'
      using errcode = '40001';
  end if;

  if jsonb_typeof(public.complete_clinical_validation.findings) <> 'array'
     or jsonb_array_length(
       public.complete_clinical_validation.findings
     ) not between 1 and 100
  then
    raise exception 'clinical findings violate the stage contract'
      using errcode = '22023';
  end if;

  for finding_row in
    select finding.value
    from jsonb_array_elements(
      public.complete_clinical_validation.findings
    ) finding(value)
  loop
    if jsonb_typeof(finding_row.value) <> 'object'
       or (
         finding_row.value
         - array[
             'code', 'severity', 'title', 'detail', 'confidence',
             'requiresAcknowledgement'
           ]
       ) <> '{}'::jsonb
       or char_length(btrim(finding_row.value->>'code'))
         not between 2 and 160
       or finding_row.value->>'severity' not in (
         'informational', 'low', 'moderate', 'high', 'critical'
       )
       or char_length(btrim(finding_row.value->>'title'))
         not between 2 and 240
       or char_length(btrim(finding_row.value->>'detail'))
         not between 2 and 4000
       or jsonb_typeof(finding_row.value->'confidence') <> 'number'
       or (finding_row.value->>'confidence')::numeric not between 0 and 1
       or jsonb_typeof(
         finding_row.value->'requiresAcknowledgement'
       ) <> 'boolean'
       or (
         finding_row.value->>'severity' in ('high', 'critical')
         and not (
           finding_row.value->>'requiresAcknowledgement'
         )::boolean
       )
    then
      raise exception 'invalid clinical finding'
        using errcode = '22023';
    end if;
  end loop;

  finding_count := jsonb_array_length(
    public.complete_clinical_validation.findings
  );

  select
    extraction.id as extraction_id,
    extraction.organization_id,
    extraction.prescription_id,
    extraction.pipeline_workflow_run_id as pipeline_id,
    extraction.raw_output,
    extraction.overall_confidence,
    prescription.patient_id,
    prescription.source,
    prescription.prescribed_at,
    prescription.expires_at,
    file.id as file_id,
    file.sha256 as file_sha256,
    ocr.id as ocr_result_id,
    ocr.provider as ocr_provider,
    ocr.model as ocr_model,
    ocr.page_count,
    ocr.confidence as ocr_confidence,
    ocr.extracted_text,
    ocr.result_sha256 as ocr_result_sha256,
    stage_run.id as workflow_id
  into strict context_row
  from public.prescription_extractions extraction
  join public.prescriptions prescription
    on prescription.id = extraction.prescription_id
   and prescription.organization_id = extraction.organization_id
  join public.prescription_files file
    on file.id = (source_event.payload->>'fileId')::uuid
   and file.organization_id = extraction.organization_id
   and file.prescription_id = extraction.prescription_id
  join public.prescription_ocr_results ocr
    on ocr.extraction_id = extraction.id
   and ocr.organization_id = extraction.organization_id
  join public.workflow_runs stage_run
    on stage_run.id = (source_event.payload->>'workflowId')::uuid
   and stage_run.organization_id = extraction.organization_id
   and stage_run.parent_workflow_run_id =
     extraction.pipeline_workflow_run_id
  where extraction.id = (source_event.payload->>'extractionId')::uuid
    and extraction.organization_id = source_event.organization_id
    and extraction.pipeline_workflow_run_id =
      (source_event.payload->>'pipelineId')::uuid
    and extraction.status = 'completed'
  for update of extraction;

  review_workflow_id := public._ensure_clinical_stage_run(
    context_row.extraction_id,
    'pharmacist_review'
  );

  insert into public.clinical_validations (
    organization_id, prescription_id, status, summary, correlation_id,
    workflow_run_id
  ) values (
    context_row.organization_id,
    context_row.prescription_id,
    'pending',
    'Automated validation completed; pharmacist decision required.',
    source_event.correlation_id,
    review_workflow_id
  )
  returning id into created_validation_id;

  for finding_row in
    select finding.value
    from jsonb_array_elements(
      public.complete_clinical_validation.findings
    ) finding(value)
  loop
    insert into public.clinical_findings (
      validation_id, kind, severity, title, detail, evidence, confidence,
      requires_acknowledgement
    ) values (
      created_validation_id,
      case
        when finding_row.value->>'code' like '%allergy%'
          then 'allergy'::public.clinical_finding_kind
        when finding_row.value->>'code' like '%interaction%'
          then 'interaction'::public.clinical_finding_kind
        when finding_row.value->>'code' like '%duplicate%'
          then 'duplicate_therapy'::public.clinical_finding_kind
        when finding_row.value->>'code' like '%dose%'
          then 'dose'::public.clinical_finding_kind
        when finding_row.value->>'code' like '%controlled%'
          then 'controlled_substance'::public.clinical_finding_kind
        when finding_row.value->>'code' like '%illegible%'
          then 'illegible'::public.clinical_finding_kind
        else 'other'::public.clinical_finding_kind
      end,
      (finding_row.value->>'severity')::public.clinical_severity,
      btrim(finding_row.value->>'title'),
      btrim(finding_row.value->>'detail'),
      jsonb_build_array(
        jsonb_build_object('code', finding_row.value->>'code')
      ),
      (finding_row.value->>'confidence')::numeric,
      (finding_row.value->>'requiresAcknowledgement')::boolean
    );
  end loop;

  evidence_document := jsonb_build_object(
    'schemaVersion', 1,
    'prescription',
    jsonb_build_object(
      'id', context_row.prescription_id,
      'patientId', context_row.patient_id,
      'source', context_row.source,
      'prescribedAt', context_row.prescribed_at,
      'expiresAt', context_row.expires_at,
      'fileId', context_row.file_id,
      'fileSha256', context_row.file_sha256
    ),
    'ocr',
    jsonb_build_object(
      'id', context_row.ocr_result_id,
      'provider', context_row.ocr_provider,
      'model', context_row.ocr_model,
      'pageCount', context_row.page_count,
      'confidence', context_row.ocr_confidence,
      'text', context_row.extracted_text,
      'resultSha256', context_row.ocr_result_sha256
    ),
    'structuredExtraction', context_row.raw_output,
    'extractionConfidence', context_row.overall_confidence,
    'validationFindings', public.complete_clinical_validation.findings,
    'runtime',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'validationWorkflowId', context_row.workflow_id,
      'reviewWorkflowId', review_workflow_id,
      'correlationId', source_event.correlation_id,
      'sourceEventId', source_event.id
    ),
    'auditReferences',
    jsonb_build_array(source_event.id::text || ':audit-completed')
  );
  evidence_hash := encode(
    public.digest(
      convert_to(evidence_document::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.clinical_evidence_packages (
    organization_id, prescription_id, extraction_id, validation_id,
    pipeline_workflow_run_id, version, evidence, content_sha256
  ) values (
    context_row.organization_id,
    context_row.prescription_id,
    context_row.extraction_id,
    created_validation_id,
    context_row.pipeline_id,
    1,
    evidence_document,
    evidence_hash
  )
  returning id into created_evidence_id;

  update public.prescription_extractions
  set status = 'completed',
      completed_at = now(),
      failure_code = null,
      failure_detail = null
  where id = context_row.extraction_id;

  update public.prescriptions
  set status = 'needs_review'
  where id = context_row.prescription_id
    and organization_id = context_row.organization_id;

  update public.workflow_runs
  set status = 'completed',
      current_step = 'completed',
      output_reference = jsonb_build_object(
        'validationId', created_validation_id,
        'evidenceId', created_evidence_id,
        'contentSha256', evidence_hash,
        'findingCount', finding_count
      ),
      completed_at = now()
  where id = context_row.workflow_id
    and organization_id = context_row.organization_id;

  update public.workflow_runs
  set status = 'waiting',
      previous_step = 'clinical_validation',
      current_step = 'pharmacist_review',
      next_step = null,
      output_reference = coalesce(output_reference, '{}'::jsonb)
        || jsonb_build_object(
          'validationId', created_validation_id,
          'evidenceId', created_evidence_id,
          'contentSha256', evidence_hash,
          'findingCount', finding_count
        )
  where id = context_row.pipeline_id
    and organization_id = context_row.organization_id;

  update public.runtime_outbox_events
  set status = 'published',
      published_at = now(),
      locked_at = null,
      locked_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null
  where id = source_event.id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    context_row.organization_id,
    context_row.workflow_id,
    'workflow.stage.completed.v1',
    'clinical_validation',
    null,
    source_event.id::text || ':workflow-completed',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id,
      'contentSha256', evidence_hash,
      'findingCount', finding_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values
  (
    context_row.organization_id,
    'prescription.clinical-validation.completed.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', context_row.workflow_id,
      'validationId', created_validation_id,
      'findingCount', finding_count
    ),
    source_event.correlation_id,
    source_event.request_id,
    context_row.workflow_id::text,
    source_event.idempotency_key || ':clinical-validation-completed'
  ),
  (
    context_row.organization_id,
    'prescription.clinical-packet.generated.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', context_row.workflow_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id,
      'contentSha256', evidence_hash
    ),
    source_event.correlation_id,
    source_event.request_id,
    context_row.workflow_id::text,
    source_event.idempotency_key || ':clinical-packet-generated'
  ),
  (
    context_row.organization_id,
    'prescription.pharmacist-review.requested.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', context_row.organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', review_workflow_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id
    ),
    source_event.correlation_id,
    source_event.request_id,
    review_workflow_id::text,
    source_event.idempotency_key || ':pharmacist-review-requested'
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    context_row.organization_id,
    'clinical.pipeline.stage',
    'system',
    public.complete_clinical_validation.worker_id,
    'prescription',
    context_row.prescription_id::text,
    'clinical_validation.complete',
    'success',
    source_event.correlation_id,
    source_event.request_id,
    source_event.id::text || ':audit-completed',
    context_row.workflow_id::text,
    'worker',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'extractionId', context_row.extraction_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id,
      'contentSha256', evidence_hash,
      'findingCount', finding_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'validationId', created_validation_id,
    'evidenceId', created_evidence_id,
    'contentSha256', evidence_hash,
    'reviewWorkflowId', review_workflow_id,
    'status', 'completed'
  );
end;
$$;

revoke all on function public.complete_clinical_validation(
  uuid, text, uuid, jsonb
) from public;
grant execute on function public.complete_clinical_validation(
  uuid, text, uuid, jsonb
) to service_role;

create or replace function public.fail_clinical_pipeline_stage(
  source_event_id uuid,
  worker_id text,
  lease_token uuid,
  error_code text,
  retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_event record;
  context_row record;
  failed_stage text;
  failure_result text;
  retry_delay_seconds integer;
  target_ai_run_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'clinical pipeline failure requires service_role'
      using errcode = '42501';
  end if;
  if char_length(btrim(
       public.fail_clinical_pipeline_stage.error_code
     )) not between 3 and 160
     or public.fail_clinical_pipeline_stage.error_code !~
       '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
  then
    raise exception 'invalid clinical pipeline error code'
      using errcode = '22023';
  end if;

  select event.* into strict source_event
  from public.runtime_outbox_events event
  where event.id = public.fail_clinical_pipeline_stage.source_event_id
  for update;

  if source_event.event_type not in (
    'prescription.queued-for-ocr.v1',
    'prescription.queued-for-parsing.v1',
    'prescription.queued-for-clinical-validation.v1'
  ) then
    raise exception 'source event is not a clinical pipeline work item'
      using errcode = '22023';
  end if;

  if source_event.status = 'retrying'::public.runtime_event_status
     and source_event.last_error_code =
       public.fail_clinical_pipeline_stage.error_code
  then
    return 'retrying';
  end if;
  if source_event.status = 'dead_letter'::public.runtime_event_status
     and source_event.last_error_code =
       public.fail_clinical_pipeline_stage.error_code
  then
    return 'failed';
  end if;

  if source_event.status <> 'publishing'::public.runtime_event_status
     or source_event.locked_by is distinct from
       public.fail_clinical_pipeline_stage.worker_id
     or source_event.lease_token is distinct from
       public.fail_clinical_pipeline_stage.lease_token
     or source_event.lease_expires_at <= now()
  then
    raise exception 'stale or invalid clinical pipeline worker lease'
      using errcode = '40001';
  end if;

  failed_stage := case source_event.event_type
    when 'prescription.queued-for-ocr.v1' then 'ocr'
    when 'prescription.queued-for-parsing.v1' then 'parsing'
    when 'prescription.queued-for-clinical-validation.v1'
      then 'clinical_validation'
  end;

  select
    extraction.id as extraction_id,
    extraction.organization_id,
    extraction.prescription_id,
    extraction.pipeline_workflow_run_id as pipeline_id,
    stage_run.id as workflow_id
  into strict context_row
  from public.prescription_extractions extraction
  join public.workflow_runs stage_run
    on stage_run.id = (source_event.payload->>'workflowId')::uuid
   and stage_run.organization_id = extraction.organization_id
   and stage_run.parent_workflow_run_id =
     extraction.pipeline_workflow_run_id
  where extraction.id = (source_event.payload->>'extractionId')::uuid
    and extraction.organization_id = source_event.organization_id
    and extraction.prescription_id = source_event.aggregate_id::uuid
    and extraction.pipeline_workflow_run_id =
      (source_event.payload->>'pipelineId')::uuid;

  if public.fail_clinical_pipeline_stage.retryable
     and source_event.retry_count < 5
  then
    retry_delay_seconds := least(
      300,
      (power(2, source_event.retry_count) * 5)::integer
    );
    update public.runtime_outbox_events
    set status = 'retrying',
        available_at = now() + make_interval(secs => retry_delay_seconds),
        locked_at = null,
        locked_by = null,
        lease_token = null,
        lease_expires_at = null,
        last_error_code =
          public.fail_clinical_pipeline_stage.error_code
    where id = source_event.id;

    update public.workflow_runs
    set status = 'queued',
        current_step = 'retrying',
        completed_at = null
    where id = context_row.workflow_id
      and organization_id = context_row.organization_id;

    update public.workflow_runs
    set status = 'running',
        current_step = failed_stage
    where id = context_row.pipeline_id
      and organization_id = context_row.organization_id;

    failure_result := 'retrying';
  else
    update public.runtime_outbox_events
    set status = 'dead_letter',
        locked_at = null,
        locked_by = null,
        lease_token = null,
        lease_expires_at = null,
        last_error_code =
          public.fail_clinical_pipeline_stage.error_code
    where id = source_event.id;

    insert into public.runtime_dead_letters (
      organization_id, outbox_event_id, event_type, payload, error_code,
      error_detail, correlation_id, retry_count
    ) values (
      context_row.organization_id,
      source_event.id,
      source_event.event_type,
      source_event.payload,
      public.fail_clinical_pipeline_stage.error_code,
      null,
      source_event.correlation_id,
      source_event.retry_count
    )
    on conflict do nothing;

    update public.prescription_extractions
    set status = 'failed',
        failure_code =
          public.fail_clinical_pipeline_stage.error_code,
        failure_detail = null,
        completed_at = now()
    where id = context_row.extraction_id;

    update public.prescriptions
    set status = 'needs_review'
    where id = context_row.prescription_id
      and organization_id = context_row.organization_id;

    update public.workflow_runs
    set status = 'failed',
        current_step = 'failed',
        completed_at = now()
    where id in (context_row.workflow_id, context_row.pipeline_id)
      and organization_id = context_row.organization_id;

    failure_result := 'failed';
  end if;

  update public.ai_runs
  set status = 'failed',
      error_code = public.fail_clinical_pipeline_stage.error_code,
      completed_at = now()
  where organization_id = context_row.organization_id
    and idempotency_key = 'clinical-stage:' || source_event.id::text
  returning id into target_ai_run_id;

  if target_ai_run_id is not null then
    insert into public.ai_audit_events (
      organization_id, ai_run_id, event_type, actor_id, idempotency_key,
      metadata
    ) values (
      context_row.organization_id,
      target_ai_run_id,
      'AI.StageFailed',
      null,
      source_event.id::text
        || ':ai-failed:'
        || source_event.retry_count::text,
      jsonb_build_object(
        'stage', failed_stage,
        'pipelineId', context_row.pipeline_id,
        'workflowId', context_row.workflow_id,
        'errorCode', public.fail_clinical_pipeline_stage.error_code,
        'result', failure_result,
        'attempt', source_event.retry_count
      )
    )
    on conflict (organization_id, idempotency_key) do nothing;
  end if;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    context_row.organization_id,
    context_row.workflow_id,
    case
      when failure_result = 'retrying'
        then 'workflow.stage.retry-scheduled.v1'
      else 'workflow.stage.failed.v1'
    end,
    failed_stage,
    null,
    source_event.id::text
      || ':workflow-failed:'
      || source_event.retry_count::text,
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'errorCode', public.fail_clinical_pipeline_stage.error_code,
      'result', failure_result,
      'attempt', source_event.retry_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    context_row.organization_id,
    'clinical.pipeline.stage',
    'system',
    public.fail_clinical_pipeline_stage.worker_id,
    'prescription',
    context_row.prescription_id::text,
    failed_stage || '.fail',
    'failure',
    source_event.correlation_id,
    source_event.request_id,
    source_event.id::text
      || ':audit-failed:'
      || source_event.retry_count::text,
    context_row.workflow_id::text,
    'worker',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'extractionId', context_row.extraction_id,
      'errorCode', public.fail_clinical_pipeline_stage.error_code,
      'result', failure_result,
      'attempt', source_event.retry_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return failure_result;
end;
$$;

revoke all on function public.fail_clinical_pipeline_stage(
  uuid, text, uuid, text, boolean
) from public;
grant execute on function public.fail_clinical_pipeline_stage(
  uuid, text, uuid, text, boolean
) to service_role;

-- PI-1 review rows are a read queue. All mutations are centralized in the
-- atomic pharmacist decision command so acknowledgements and final-state
-- invariants cannot be bypassed through direct table updates.
drop policy clinical_validations_clinical
  on public.clinical_validations;
drop policy clinical_findings_clinical
  on public.clinical_findings;

create policy clinical_validations_verified_pharmacist_read
  on public.clinical_validations for select to authenticated
  using (
    public.is_verified_active_pharmacist(organization_id, auth.uid())
  );

create policy clinical_findings_verified_pharmacist_read
  on public.clinical_findings for select to authenticated
  using (
    exists (
      select 1
      from public.clinical_validations validation
      where validation.id = clinical_findings.validation_id
        and public.is_verified_active_pharmacist(
          validation.organization_id,
          auth.uid()
        )
    )
  );

create or replace function public.guard_clinical_validation_final_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'clinical validations cannot be deleted';
  end if;
  if old.status <> 'pending'::public.review_status then
    raise exception 'final clinical validation is immutable';
  end if;
  return new;
end;
$$;

create trigger clinical_validations_final_state_guard
before update or delete on public.clinical_validations
for each row execute function public.guard_clinical_validation_final_state();

create or replace function public.guard_clinical_finding_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'clinical findings cannot be deleted';
  end if;
  if new.validation_id is distinct from old.validation_id
     or new.prescription_item_id is distinct from old.prescription_item_id
     or new.kind is distinct from old.kind
     or new.severity is distinct from old.severity
     or new.title is distinct from old.title
     or new.detail is distinct from old.detail
     or new.evidence is distinct from old.evidence
     or new.confidence is distinct from old.confidence
     or new.requires_acknowledgement is distinct from
       old.requires_acknowledgement
  then
    raise exception 'clinical finding evidence is immutable';
  end if;
  if old.acknowledged_at is not null
     and (
       new.acknowledged_at is distinct from old.acknowledged_at
       or new.acknowledged_by is distinct from old.acknowledged_by
     )
  then
    raise exception 'clinical finding acknowledgement is immutable';
  end if;
  if old.acknowledged_at is null
     and new.acknowledged_at is not null
  then
    select validation.organization_id
    into strict target_organization_id
    from public.clinical_validations validation
    where validation.id = new.validation_id;
    if auth.uid() is null
       or new.acknowledged_by is distinct from auth.uid()
       or not public.is_verified_active_pharmacist(
         target_organization_id,
         auth.uid()
       )
    then
      raise exception
        'finding acknowledgement requires a verified active pharmacist'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger clinical_findings_evidence_guard
before update or delete on public.clinical_findings
for each row execute function public.guard_clinical_finding_evidence();

create or replace function public.guard_prescription_final_clinical_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorized_validation_id uuid;
begin
  if old.status in (
     'validated'::public.prescription_status,
       'rejected'::public.prescription_status
     )
     and (
       new.status is distinct from old.status
       or new.validated_by is distinct from old.validated_by
       or new.validated_at is distinct from old.validated_at
       or new.rejection_reason is distinct from old.rejection_reason
     )
  then
    raise exception 'final prescription clinical state is immutable'
      using errcode = '42501';
  end if;

  if new.status in (
       'validated'::public.prescription_status,
       'rejected'::public.prescription_status
     )
     and new.status is distinct from old.status
  then
    begin
      authorized_validation_id := nullif(
        current_setting(
          'medlink.authorized_clinical_validation_id',
          true
        ),
        ''
      )::uuid;
    exception
      when invalid_text_representation then
        authorized_validation_id := null;
    end;

    if authorized_validation_id is null
       or not exists (
         select 1
         from public.clinical_validations validation
         where validation.id = authorized_validation_id
           and validation.organization_id = new.organization_id
           and validation.prescription_id = new.id
           and validation.reviewed_by = auth.uid()
           and validation.reviewed_at is not null
           and (
             (
               new.status = 'validated'::public.prescription_status
               and validation.status = 'approved'::public.review_status
             )
             or
             (
               new.status = 'rejected'::public.prescription_status
               and validation.status = 'rejected'::public.review_status
             )
           )
       )
    then
      raise exception
        'final prescription state requires an authorized pharmacist decision'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger prescriptions_final_clinical_decision_guard
before update of status, validated_by, validated_at, rejection_reason
on public.prescriptions
for each row execute function public.guard_prescription_final_clinical_decision();

create or replace function public.decide_prescription_validation(
  organization_id uuid,
  validation_id uuid,
  decision public.review_status,
  rationale text,
  acknowledged_finding_ids uuid[],
  idempotency_key text,
  correlation_id text,
  request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  validation_row record;
  existing_event record;
  required_acknowledgement_count integer;
  supplied_acknowledgement_count integer;
  matched_acknowledgement_count integer;
  terminal_event_type text;
  prescription_outcome public.prescription_status;
begin
  if actor_id is null
     or not public.is_verified_active_pharmacist(
       public.decide_prescription_validation.organization_id,
       actor_id
     )
  then
    raise exception
      'a verified active pharmacist is required for clinical decisions'
      using errcode = '42501';
  end if;
  if public.decide_prescription_validation.decision not in (
       'approved'::public.review_status,
       'rejected'::public.review_status,
       'needs_information'::public.review_status
     )
     or char_length(btrim(
       public.decide_prescription_validation.rationale
     )) not between 3 and 4000
     or char_length(btrim(
       public.decide_prescription_validation.idempotency_key
     )) not between 3 and 200
     or char_length(btrim(
       public.decide_prescription_validation.correlation_id
     )) not between 1 and 200
     or char_length(btrim(
       public.decide_prescription_validation.request_id
     )) not between 1 and 200
  then
    raise exception 'invalid pharmacist decision request'
      using errcode = '22023';
  end if;

  select
    validation.id,
    validation.organization_id,
    validation.prescription_id,
    validation.status,
    validation.workflow_run_id,
    validation.decision_rationale,
    review_run.parent_workflow_run_id as pipeline_id,
    evidence.id as evidence_id,
    evidence.extraction_id
  into strict validation_row
  from public.clinical_validations validation
  join public.workflow_runs review_run
    on review_run.id = validation.workflow_run_id
   and review_run.organization_id = validation.organization_id
  join public.clinical_evidence_packages evidence
    on evidence.validation_id = validation.id
   and evidence.organization_id = validation.organization_id
   and evidence.version = 1
  where validation.id =
      public.decide_prescription_validation.validation_id
    and validation.organization_id =
      public.decide_prescription_validation.organization_id
  for update of validation;

  select event.* into existing_event
  from public.runtime_outbox_events event
  where event.organization_id =
      public.decide_prescription_validation.organization_id
    and event.idempotency_key =
      public.decide_prescription_validation.idempotency_key
        || ':review-completed';

  if found then
    if (existing_event.payload->>'validationId')::uuid <>
         public.decide_prescription_validation.validation_id
       or existing_event.payload->>'decision' <>
         public.decide_prescription_validation.decision::text
       or validation_row.decision_rationale is distinct from btrim(
         public.decide_prescription_validation.rationale
       )
       or array(
         select distinct supplied_id
         from unnest(
           coalesce(
             public.decide_prescription_validation.acknowledged_finding_ids,
             array[]::uuid[]
           )
         ) as supplied(supplied_id)
         order by supplied_id
       ) is distinct from array(
         select finding.id
         from public.clinical_findings finding
         where finding.validation_id = validation_row.id
           and finding.acknowledged_by = actor_id
         order by finding.id
       )
    then
      raise exception 'idempotency key was used for another decision'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'reviewId', validation_row.id,
      'validationId', validation_row.id,
      'prescriptionId', validation_row.prescription_id,
      'decision', existing_event.payload->>'decision',
      'status', 'completed'
    );
  end if;

  if validation_row.status <> 'pending'::public.review_status then
    raise exception 'clinical validation already has a final decision'
      using errcode = '23505';
  end if;

  if array_position(
       coalesce(
         public.decide_prescription_validation.acknowledged_finding_ids,
         array[]::uuid[]
       ),
       null
     ) is not null
  then
    raise exception 'finding acknowledgement identifiers cannot be null'
      using errcode = '22023';
  end if;

  select count(distinct finding_id)
  into supplied_acknowledgement_count
  from unnest(
    coalesce(
      public.decide_prescription_validation.acknowledged_finding_ids,
      array[]::uuid[]
    )
  ) as supplied(finding_id);

  select count(*)
  into matched_acknowledgement_count
  from public.clinical_findings finding
  where finding.validation_id = validation_row.id
    and finding.id = any(
      coalesce(
        public.decide_prescription_validation.acknowledged_finding_ids,
        array[]::uuid[]
      )
    );

  if supplied_acknowledgement_count <> matched_acknowledgement_count then
    raise exception 'one or more acknowledgements do not belong to the review'
      using errcode = '22023';
  end if;

  select count(*)
  into required_acknowledgement_count
  from public.clinical_findings finding
  where finding.validation_id = validation_row.id
    and finding.requires_acknowledgement
    and not (
      finding.id = any(
        coalesce(
          public.decide_prescription_validation.acknowledged_finding_ids,
          array[]::uuid[]
        )
      )
    );

  if required_acknowledgement_count > 0 then
    raise exception
      'all required clinical findings must be explicitly acknowledged'
      using errcode = '22023';
  end if;

  update public.clinical_findings
  set acknowledged_by = actor_id,
      acknowledged_at = now()
  where validation_id = validation_row.id
    and id = any(
      coalesce(
        public.decide_prescription_validation.acknowledged_finding_ids,
        array[]::uuid[]
      )
    )
    and acknowledged_at is null;

  update public.clinical_validations
  set status = public.decide_prescription_validation.decision,
      reviewed_by = actor_id,
      reviewed_at = now(),
      decision_rationale = btrim(
        public.decide_prescription_validation.rationale
      ),
      pharmacist_acknowledged_high_risk_at = case
        when exists (
          select 1
          from public.clinical_findings finding
          where finding.validation_id = validation_row.id
            and finding.severity in (
              'high'::public.clinical_severity,
              'critical'::public.clinical_severity
            )
        ) then now()
        else null
      end
  where id = validation_row.id
    and organization_id = validation_row.organization_id;

  perform set_config(
    'medlink.authorized_clinical_validation_id',
    validation_row.id::text,
    true
  );

  if public.decide_prescription_validation.decision =
     'approved'::public.review_status
  then
    prescription_outcome := 'validated';
    terminal_event_type := 'prescription.clinically-approved.v1';
    update public.prescriptions
    set status = 'validated',
        validated_by = actor_id,
        validated_at = now(),
        rejection_reason = null
    where id = validation_row.prescription_id
      and organization_id = validation_row.organization_id;
  elsif public.decide_prescription_validation.decision =
        'rejected'::public.review_status
  then
    prescription_outcome := 'rejected';
    terminal_event_type := 'prescription.clinically-rejected.v1';
    update public.prescriptions
    set status = 'rejected',
        validated_by = null,
        validated_at = null,
        rejection_reason = btrim(
          public.decide_prescription_validation.rationale
        )
    where id = validation_row.prescription_id
      and organization_id = validation_row.organization_id;
  else
    prescription_outcome := 'needs_review';
    terminal_event_type := 'prescription.clarification-requested.v1';
    update public.prescriptions
    set status = 'needs_review',
        validated_by = null,
        validated_at = null
    where id = validation_row.prescription_id
      and organization_id = validation_row.organization_id;
  end if;

  update public.workflow_runs
  set status = 'completed',
      current_step = 'completed',
      output_reference = jsonb_build_object(
        'validationId', validation_row.id,
        'decision', public.decide_prescription_validation.decision,
        'pharmacistId', actor_id
      ),
      started_at = coalesce(started_at, now()),
      completed_at = now()
  where id = validation_row.workflow_run_id
    and organization_id = validation_row.organization_id;

  update public.workflow_runs
  set status = case
        when public.decide_prescription_validation.decision =
          'needs_information'::public.review_status
          then 'waiting'::public.workflow_run_status
        else 'completed'::public.workflow_run_status
      end,
      previous_step = 'pharmacist_review',
      current_step = case
        when public.decide_prescription_validation.decision =
          'needs_information'::public.review_status
          then 'clarification'
        else 'completed'
      end,
      next_step = null,
      completed_at = case
        when public.decide_prescription_validation.decision =
          'needs_information'::public.review_status
          then null
        else now()
      end,
      output_reference = coalesce(output_reference, '{}'::jsonb)
        || jsonb_build_object(
          'validationId', validation_row.id,
          'decision', public.decide_prescription_validation.decision,
          'pharmacistId', actor_id
        )
  where id = validation_row.pipeline_id
    and organization_id = validation_row.organization_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values
  (
    validation_row.organization_id,
    validation_row.workflow_run_id,
    'workflow.human-decision.completed.v1',
    'pharmacist_review',
    actor_id,
    public.decide_prescription_validation.idempotency_key
      || ':workflow-review-completed',
    jsonb_build_object(
      'pipelineId', validation_row.pipeline_id,
      'validationId', validation_row.id,
      'decision', public.decide_prescription_validation.decision,
      'acknowledgedFindingCount', supplied_acknowledgement_count
    )
  ),
  (
    validation_row.organization_id,
    validation_row.pipeline_id,
    case
      when public.decide_prescription_validation.decision =
        'needs_information'::public.review_status
        then 'pipeline.waiting-for-clarification.v1'
      else 'pipeline.completed.v1'
    end,
    case
      when public.decide_prescription_validation.decision =
        'needs_information'::public.review_status
        then 'clarification'
      else 'completed'
    end,
    actor_id,
    public.decide_prescription_validation.idempotency_key
      || ':pipeline-decision',
    jsonb_build_object(
      'validationId', validation_row.id,
      'decision', public.decide_prescription_validation.decision
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values
  (
    validation_row.organization_id,
    'prescription.pharmacist-review.completed.v1',
    'prescription',
    validation_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', validation_row.organization_id,
      'prescriptionId', validation_row.prescription_id,
      'extractionId', validation_row.extraction_id,
      'pipelineId', validation_row.pipeline_id,
      'workflowId', validation_row.workflow_run_id,
      'validationId', validation_row.id,
      'evidenceId', validation_row.evidence_id,
      'decision', public.decide_prescription_validation.decision
    ),
    public.decide_prescription_validation.correlation_id,
    public.decide_prescription_validation.request_id,
    validation_row.workflow_run_id::text,
    public.decide_prescription_validation.idempotency_key
      || ':review-completed'
  ),
  (
    validation_row.organization_id,
    terminal_event_type,
    'prescription',
    validation_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', validation_row.organization_id,
      'prescriptionId', validation_row.prescription_id,
      'extractionId', validation_row.extraction_id,
      'pipelineId', validation_row.pipeline_id,
      'workflowId', validation_row.workflow_run_id,
      'validationId', validation_row.id,
      'evidenceId', validation_row.evidence_id,
      'decision', public.decide_prescription_validation.decision
    ),
    public.decide_prescription_validation.correlation_id,
    public.decide_prescription_validation.request_id,
    validation_row.workflow_run_id::text,
    public.decide_prescription_validation.idempotency_key
      || ':terminal'
  )
  on conflict (organization_id, idempotency_key) do nothing;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_id, actor_type, resource_type,
    resource_id, action, outcome, purpose, correlation_id, request_id,
    idempotency_key, workflow_id, source_channel, metadata
  ) values (
    validation_row.organization_id,
    'clinical.pharmacist.decision',
    actor_id,
    'user',
    'prescription',
    validation_row.prescription_id::text,
    'pharmacist_review.'
      || public.decide_prescription_validation.decision::text,
    'success',
    'pharmacist-supervised prescription fulfillment',
    public.decide_prescription_validation.correlation_id,
    public.decide_prescription_validation.request_id,
    public.decide_prescription_validation.idempotency_key || ':audit',
    validation_row.workflow_run_id::text,
    'api',
    jsonb_build_object(
      'pipelineId', validation_row.pipeline_id,
      'validationId', validation_row.id,
      'evidenceId', validation_row.evidence_id,
      'decision', public.decide_prescription_validation.decision,
      'acknowledgedFindingCount', supplied_acknowledgement_count
    )
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'reviewId', validation_row.id,
    'validationId', validation_row.id,
    'prescriptionId', validation_row.prescription_id,
    'decision', public.decide_prescription_validation.decision,
    'prescriptionStatus', prescription_outcome,
    'status', 'completed'
  );
end;
$$;

revoke all on function public.decide_prescription_validation(
  uuid, uuid, public.review_status, text, uuid[], text, text, text
) from public;
grant execute on function public.decide_prescription_validation(
  uuid, uuid, public.review_status, text, uuid[], text, text, text
) to authenticated;
