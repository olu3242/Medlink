-- RC2 MVP Batch 2: pharmacist-owned medicine resolution and clarification loop.
-- ARC remains deterministic. Only a verified pharmacist can resolve and decide.

create table public.clinical_review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  validation_id uuid not null,
  prescription_item_id uuid not null references public.prescription_items(id),
  medicine_id uuid not null references public.medicines(id),
  resolution_kind text not null check (
    resolution_kind in ('confirmed', 'corrected')
  ),
  resolved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (validation_id, prescription_item_id),
  foreign key (validation_id, organization_id)
    references public.clinical_validations(id, organization_id)
    on delete restrict
);

create index clinical_review_items_medicine_idx
  on public.clinical_review_items(medicine_id, created_at desc);

alter table public.clinical_review_items enable row level security;

create policy clinical_review_items_verified_pharmacist_read
  on public.clinical_review_items for select to authenticated
  using (public.is_verified_active_pharmacist(organization_id, auth.uid()));

revoke insert, update, delete on public.clinical_review_items
  from authenticated;
grant select on public.clinical_review_items to authenticated;

create or replace function public.prevent_clinical_review_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'clinical review item resolutions are append-only';
end;
$$;

create trigger clinical_review_items_append_only
before update or delete on public.clinical_review_items
for each row execute function public.prevent_clinical_review_item_mutation();

create table public.prescription_clarifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  prescription_id uuid not null,
  validation_id uuid not null,
  status text not null default 'requested' check (
    status in ('requested', 'responded')
  ),
  request_text text not null check (
    char_length(btrim(request_text)) between 3 and 4000
  ),
  response_text text,
  response_sha256 text check (
    response_sha256 is null or response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  requested_by uuid not null references auth.users(id),
  responded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (validation_id),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete restrict,
  foreign key (validation_id, organization_id)
    references public.clinical_validations(id, organization_id)
    on delete restrict,
  check (
    (
      status = 'requested'
      and response_text is null
      and response_sha256 is null
      and responded_by is null
      and responded_at is null
    )
    or
    (
      status = 'responded'
      and char_length(btrim(response_text)) between 3 and 4000
      and response_sha256 is not null
      and responded_by is not null
      and responded_at is not null
    )
  )
);

create index prescription_clarifications_patient_queue_idx
  on public.prescription_clarifications(
    organization_id, prescription_id, status, created_at desc
  );

alter table public.prescription_clarifications enable row level security;

create policy prescription_clarifications_participant_read
  on public.prescription_clarifications for select to authenticated
  using (
    public.is_verified_active_pharmacist(organization_id, auth.uid())
    or exists (
      select 1
      from public.prescriptions prescription
      where prescription.id = prescription_clarifications.prescription_id
        and prescription.organization_id =
          prescription_clarifications.organization_id
        and prescription.patient_id = auth.uid()
        and prescription.deleted_at is null
    )
  );

revoke insert, update, delete on public.prescription_clarifications
  from authenticated;
grant select on public.prescription_clarifications to authenticated;

create or replace function public.guard_prescription_clarification_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'prescription clarifications cannot be deleted';
  end if;
  if coalesce(
       current_setting('medlink.clarification_response', true),
       'off'
     ) <> 'on'
     or old.status <> 'requested'
     or new.status <> 'responded'
     or new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.prescription_id <> old.prescription_id
     or new.validation_id <> old.validation_id
     or new.request_text <> old.request_text
     or new.requested_by <> old.requested_by
     or new.created_at <> old.created_at
  then
    raise exception 'prescription clarification history is immutable';
  end if;
  return new;
end;
$$;

create trigger prescription_clarifications_history_guard
before update or delete on public.prescription_clarifications
for each row execute function public.guard_prescription_clarification_mutation();

create or replace function public.decide_prescription_validation_with_resolution(
  target_organization_id uuid,
  target_validation_id uuid,
  target_decision public.review_status,
  target_rationale text,
  target_acknowledged_finding_ids uuid[],
  target_reviewed_items jsonb,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership_id uuid;
  validation_row record;
  item_row record;
  existing_item record;
  prior_event record;
  normalized_items jsonb := '[]'::jsonb;
  content_hash text;
  prescription_item_count integer;
  reviewed_item_count integer;
  decision_result jsonb;
begin
  if actor_id is null
     or target_organization_id is null
     or target_validation_id is null
     or target_decision is null
     or target_rationale is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or target_decision not in (
       'approved'::public.review_status,
       'rejected'::public.review_status,
       'needs_information'::public.review_status
     )
     or char_length(btrim(target_rationale)) not between 3 and 4000
     or char_length(btrim(target_idempotency_key)) not between 3 and 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
     or target_reviewed_items is null
     or jsonb_typeof(target_reviewed_items) <> 'array'
     or jsonb_array_length(target_reviewed_items) > 100
     or not public.is_verified_active_pharmacist(
       target_organization_id,
       actor_id
     )
  then
    raise exception 'invalid pharmacist medicine resolution context'
      using errcode = '42501';
  end if;

  select membership.id into strict membership_id
  from public.organization_memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = actor_id
    and membership.role = 'pharmacist'::public.member_role
    and membership.deleted_at is null;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || target_idempotency_key,
      0
    )
  );

  select
    validation.id,
    validation.organization_id,
    validation.prescription_id,
    validation.status
  into strict validation_row
  from public.clinical_validations validation
  where validation.id = target_validation_id
    and validation.organization_id = target_organization_id
  for update;

  for item_row in
    select item.value
    from jsonb_array_elements(target_reviewed_items) item(value)
  loop
    if jsonb_typeof(item_row.value) <> 'object'
       or not (
         item_row.value ?& array['prescriptionItemId', 'medicineId']
       )
       or (
         item_row.value - array['prescriptionItemId', 'medicineId']
       ) <> '{}'::jsonb
       or jsonb_typeof(item_row.value->'prescriptionItemId') <> 'string'
       or jsonb_typeof(item_row.value->'medicineId') <> 'string'
       or (item_row.value->>'prescriptionItemId') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or (item_row.value->>'medicineId') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      raise exception 'invalid reviewed prescription item'
        using errcode = '22023';
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'medicineId', item.value->>'medicineId',
        'prescriptionItemId', item.value->>'prescriptionItemId'
      ) order by item.value->>'prescriptionItemId'
    ),
    '[]'::jsonb
  ) into normalized_items
  from jsonb_array_elements(target_reviewed_items) item(value);

  content_hash := encode(
    public.digest(convert_to(normalized_items::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select event.* into prior_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key =
      target_idempotency_key || ':medicine-resolution';

  if found then
    if prior_event.payload->>'contentSha256' <> content_hash
       or (prior_event.payload->>'validationId')::uuid <>
         target_validation_id
    then
      raise exception 'review resolution idempotency conflict'
        using errcode = '23505';
    end if;
    decision_result := public.decide_prescription_validation(
      target_organization_id,
      target_validation_id,
      target_decision,
      target_rationale,
      target_acknowledged_finding_ids,
      target_idempotency_key,
      target_correlation_id,
      target_request_id
    );
    return decision_result || jsonb_build_object(
      'resolvedItemCount', jsonb_array_length(normalized_items),
      'resolutionSha256', content_hash
    );
  end if;

  if validation_row.status <> 'pending'::public.review_status then
    raise exception 'clinical validation already has a final decision'
      using errcode = '23505';
  end if;

  select count(*) into prescription_item_count
  from public.prescription_items item
  where item.prescription_id = validation_row.prescription_id;

  select count(distinct (item.value->>'prescriptionItemId')::uuid)
  into reviewed_item_count
  from jsonb_array_elements(target_reviewed_items) item(value);

  if reviewed_item_count <> jsonb_array_length(target_reviewed_items)
  then
    raise exception 'reviewed prescription items must be unique'
      using errcode = '22023';
  end if;

  if target_decision = 'approved'::public.review_status
     and (
       prescription_item_count = 0
       or reviewed_item_count <> prescription_item_count
     )
  then
    raise exception 'approval requires every prescription item to be resolved'
      using errcode = '22023';
  end if;

  for item_row in
    select
      (item.value->>'prescriptionItemId')::uuid as prescription_item_id,
      (item.value->>'medicineId')::uuid as medicine_id
    from jsonb_array_elements(target_reviewed_items) item(value)
    order by item.value->>'prescriptionItemId'
  loop
    select prescription_item.* into strict existing_item
    from public.prescription_items prescription_item
    where prescription_item.id = item_row.prescription_item_id
      and prescription_item.prescription_id = validation_row.prescription_id
    for update;

    if not exists (
      select 1
      from public.medicines medicine
      where medicine.id = item_row.medicine_id
        and medicine.status = 'active'::public.medicine_record_status
        and medicine.deleted_at is null
    ) then
      raise exception 'reviewed medicine is not active in the catalogue'
        using errcode = '23503';
    end if;

    insert into public.clinical_review_items (
      organization_id, validation_id, prescription_item_id, medicine_id,
      resolution_kind, resolved_by
    ) values (
      target_organization_id,
      target_validation_id,
      item_row.prescription_item_id,
      item_row.medicine_id,
      case
        when existing_item.medicine_id = item_row.medicine_id
          then 'confirmed'
        else 'corrected'
      end,
      actor_id
    );

    update public.prescription_items
    set medicine_id = item_row.medicine_id,
        updated_at = now()
    where id = item_row.prescription_item_id;
  end loop;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    'prescription.medicine-resolution-recorded.v1',
    'prescription',
    validation_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', validation_row.prescription_id,
      'validationId', target_validation_id,
      'itemCount', reviewed_item_count,
      'contentSha256', content_hash
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':medicine-resolution'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_id, actor_type, resource_type,
    resource_id, action, outcome, purpose, correlation_id, request_id,
    idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'clinical.medicine-resolution',
    actor_id,
    'user',
    'prescription',
    validation_row.prescription_id::text,
    'pharmacist_review.resolve-items',
    'success',
    'pharmacist-supervised prescription fulfillment',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':medicine-resolution-audit',
    'api',
    jsonb_build_object(
      'validationId', target_validation_id,
      'membershipId', membership_id,
      'itemCount', reviewed_item_count,
      'contentSha256', content_hash
    )
  );

  decision_result := public.decide_prescription_validation(
    target_organization_id,
    target_validation_id,
    target_decision,
    target_rationale,
    target_acknowledged_finding_ids,
    target_idempotency_key,
    target_correlation_id,
    target_request_id
  );

  if target_decision = 'needs_information'::public.review_status then
    insert into public.prescription_clarifications (
      organization_id, prescription_id, validation_id, request_text,
      requested_by
    ) values (
      target_organization_id,
      validation_row.prescription_id,
      target_validation_id,
      btrim(target_rationale),
      actor_id
    );
  end if;

  return decision_result || jsonb_build_object(
    'resolvedItemCount', reviewed_item_count,
    'resolutionSha256', content_hash
  );
end;
$$;

revoke execute on function public.decide_prescription_validation(
  uuid, uuid, public.review_status, text, uuid[], text, text, text
) from authenticated;
revoke all on function public.decide_prescription_validation_with_resolution(
  uuid, uuid, public.review_status, text, uuid[], jsonb, text, text, text
) from public;
grant execute on function public.decide_prescription_validation_with_resolution(
  uuid, uuid, public.review_status, text, uuid[], jsonb, text, text, text
) to authenticated;

create or replace function public.respond_prescription_clarification(
  target_organization_id uuid,
  target_clarification_id uuid,
  target_response_text text,
  target_idempotency_key text,
  target_correlation_id text,
  target_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  context_row record;
  prior_event record;
  new_review_id uuid;
  new_workflow_id uuid;
  new_evidence_id uuid;
  new_evidence jsonb;
  new_evidence_hash text;
  response_hash text;
begin
  if actor_id is null
     or target_organization_id is null
     or target_clarification_id is null
     or target_response_text is null
     or target_idempotency_key is null
     or target_correlation_id is null
     or target_request_id is null
     or char_length(btrim(target_response_text)) not between 3 and 4000
     or char_length(btrim(target_idempotency_key)) not between 3 and 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid clarification response'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || target_idempotency_key,
      0
    )
  );

  response_hash := encode(
    public.digest(
      convert_to(btrim(target_response_text), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select
    clarification.*,
    prescription.patient_id,
    evidence.id as evidence_id,
    evidence.extraction_id,
    evidence.pipeline_workflow_run_id as pipeline_id,
    evidence.evidence,
    review_run.workflow_definition_id
  into strict context_row
  from public.prescription_clarifications clarification
  join public.prescriptions prescription
    on prescription.id = clarification.prescription_id
   and prescription.organization_id = clarification.organization_id
  join public.clinical_evidence_packages evidence
    on evidence.validation_id = clarification.validation_id
   and evidence.organization_id = clarification.organization_id
   and evidence.version = 1
  join public.clinical_validations validation
    on validation.id = clarification.validation_id
   and validation.organization_id = clarification.organization_id
  join public.workflow_runs review_run
    on review_run.id = validation.workflow_run_id
   and review_run.organization_id = validation.organization_id
  where clarification.id = target_clarification_id
    and clarification.organization_id = target_organization_id
  for update of clarification;

  if context_row.patient_id <> actor_id then
    raise exception 'only the prescription patient may respond'
      using errcode = '42501';
  end if;

  select event.* into prior_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key =
      target_idempotency_key || ':clarification-responded';

  if found then
    if (prior_event.payload->>'clarificationId')::uuid <>
         target_clarification_id
       or context_row.response_sha256 is distinct from response_hash
    then
      raise exception 'clarification response idempotency conflict'
        using errcode = '23505';
    end if;
    return prior_event.payload;
  end if;

  if context_row.status <> 'requested' then
    raise exception 'clarification already has a response'
      using errcode = '23505';
  end if;

  perform set_config('medlink.clarification_response', 'on', true);
  update public.prescription_clarifications
  set status = 'responded',
      response_text = btrim(target_response_text),
      response_sha256 = response_hash,
      responded_by = actor_id,
      responded_at = now()
  where id = target_clarification_id;

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, parent_workflow_run_id,
    status, subject_type, subject_reference, input_reference,
    current_step, previous_step, next_step, idempotency_key,
    correlation_id, created_by
  ) values (
    target_organization_id,
    context_row.workflow_definition_id,
    context_row.pipeline_id,
    'waiting',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'clarificationId', target_clarification_id
    ),
    'awaiting_pharmacist',
    'clarification',
    null,
    target_idempotency_key || ':review-workflow',
    target_correlation_id,
    actor_id
  ) returning id into new_workflow_id;

  insert into public.clinical_validations (
    organization_id, prescription_id, status, summary, correlation_id,
    workflow_run_id
  ) values (
    target_organization_id,
    context_row.prescription_id,
    'pending',
    'Patient clarification received; independent pharmacist re-review required.',
    target_correlation_id,
    new_workflow_id
  ) returning id into new_review_id;

  insert into public.clinical_findings (
    validation_id, prescription_item_id, kind, severity, title, detail,
    evidence, confidence, requires_acknowledgement
  )
  select
    new_review_id,
    finding.prescription_item_id,
    finding.kind,
    finding.severity,
    finding.title,
    finding.detail,
    finding.evidence,
    finding.confidence,
    finding.requires_acknowledgement
  from public.clinical_findings finding
  where finding.validation_id = context_row.validation_id;

  new_evidence := context_row.evidence || jsonb_build_object(
    'clarificationId', target_clarification_id,
    'clarificationResponseReceived', true,
    'reviewWorkflowId', new_workflow_id,
    'validationId', new_review_id
  );
  new_evidence_hash := encode(
    public.digest(convert_to(new_evidence::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.clinical_evidence_packages (
    organization_id, prescription_id, extraction_id, validation_id,
    pipeline_workflow_run_id, version, evidence, content_sha256
  ) values (
    target_organization_id,
    context_row.prescription_id,
    context_row.extraction_id,
    new_review_id,
    context_row.pipeline_id,
    1,
    new_evidence,
    new_evidence_hash
  ) returning id into new_evidence_id;

  update public.workflow_runs
  set status = 'waiting',
      previous_step = 'clarification',
      current_step = 'pharmacist_review',
      next_step = null,
      output_reference = coalesce(output_reference, '{}'::jsonb)
        || jsonb_build_object(
          'clarificationId', target_clarification_id,
          'validationId', new_review_id
        ),
      completed_at = null
  where id = context_row.pipeline_id
    and organization_id = target_organization_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    target_organization_id,
    new_workflow_id,
    'workflow.human-review.requeued.v1',
    'pharmacist_review',
    actor_id,
    target_idempotency_key || ':review-requeued',
    jsonb_build_object(
      'pipelineId', context_row.pipeline_id,
      'clarificationId', target_clarification_id,
      'validationId', new_review_id
    )
  );

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values
  (
    target_organization_id,
    'prescription.clarification-responded.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', context_row.prescription_id,
      'clarificationId', target_clarification_id,
      'validationId', new_review_id,
      'workflowId', new_workflow_id
    ),
    target_correlation_id,
    target_request_id,
    new_workflow_id::text,
    target_idempotency_key || ':clarification-responded'
  ),
  (
    target_organization_id,
    'prescription.pharmacist-review.requested.v1',
    'prescription',
    context_row.prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', context_row.prescription_id,
      'extractionId', context_row.extraction_id,
      'pipelineId', context_row.pipeline_id,
      'workflowId', new_workflow_id,
      'validationId', new_review_id,
      'evidenceId', new_evidence_id
    ),
    target_correlation_id,
    target_request_id,
    new_workflow_id::text,
    target_idempotency_key || ':pharmacist-review-requested'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_id, actor_type, resource_type,
    resource_id, action, outcome, purpose, correlation_id, request_id,
    idempotency_key, workflow_id, source_channel, metadata
  ) values (
    target_organization_id,
    'prescription.clarification',
    actor_id,
    'user',
    'prescription',
    context_row.prescription_id::text,
    'clarification.respond',
    'success',
    'patient-provided clinical clarification',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit',
    new_workflow_id::text,
    'api',
    jsonb_build_object(
      'clarificationId', target_clarification_id,
      'validationId', new_review_id,
      'responseLength', char_length(btrim(target_response_text))
    )
  );

  return jsonb_build_object(
    'tenantId', target_organization_id,
    'prescriptionId', context_row.prescription_id,
    'clarificationId', target_clarification_id,
    'validationId', new_review_id,
    'workflowId', new_workflow_id,
    'status', 'responded'
  );
end;
$$;

revoke all on function public.respond_prescription_clarification(
  uuid, uuid, text, text, text, text
) from public;
grant execute on function public.respond_prescription_clarification(
  uuid, uuid, text, text, text, text
) to authenticated;

comment on table public.clinical_review_items is
  'Append-only pharmacist resolution of prescription items to the canonical medicine catalogue.';
comment on table public.prescription_clarifications is
  'RLS-protected clinical clarification text. Contents must never enter logs or outbox payloads.';
