-- RC2 MVP: patient prescription management and manual prescription intake.
--
-- This migration extends the canonical prescriptions and prescription_items
-- tables. It deliberately reuses the PI-1 pharmacist-review evidence chain,
-- workflow runtime, outbox, audit trail, and medicine catalogue.

alter table public.prescriptions
  add column prescriber_name text,
  add column facility_name text,
  add column patient_notes text,
  add column version integer not null default 1;

alter table public.prescriptions
  add constraint prescriptions_prescriber_name_length check (
    prescriber_name is null
    or char_length(btrim(prescriber_name)) between 1 and 240
  ),
  add constraint prescriptions_facility_name_length check (
    facility_name is null
    or char_length(btrim(facility_name)) between 1 and 240
  ),
  add constraint prescriptions_patient_notes_length check (
    patient_notes is null
    or char_length(btrim(patient_notes)) between 1 and 4000
  ),
  add constraint prescriptions_version_positive check (version > 0);

comment on column public.prescriptions.version is
  'Optimistic concurrency version for patient-editable manual drafts.';
comment on column public.prescriptions.patient_notes is
  'RLS-protected patient context. Never copy this field into event payloads or logs.';

create or replace function public._normalize_manual_prescription_items(
  target_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row record;
  medicine_row record;
  normalized_items jsonb := '[]'::jsonb;
  item_value jsonb;
begin
  if jsonb_typeof(target_items) <> 'array'
     or jsonb_array_length(target_items) not between 1 and 30
  then
    raise exception 'manual prescription must contain between 1 and 30 items'
      using errcode = '22023';
  end if;

  for item_row in
    select item.value, item.ordinality
    from jsonb_array_elements(target_items) with ordinality item(value, ordinality)
  loop
    item_value := item_row.value;
    if jsonb_typeof(item_value) <> 'object'
       or (
         item_value
         - array[
             'medicineId', 'strength', 'dosage', 'route', 'frequency',
             'duration', 'quantity', 'quantityUnit', 'refills', 'directions'
           ]
       ) <> '{}'::jsonb
       or jsonb_typeof(item_value->'medicineId') <> 'string'
       or (item_value->>'medicineId') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or jsonb_typeof(item_value->'strength') <> 'string'
       or char_length(btrim(item_value->>'strength')) not between 1 and 100
       or jsonb_typeof(item_value->'dosage') <> 'string'
       or char_length(btrim(item_value->>'dosage')) not between 1 and 500
       or (
         item_value ? 'route'
         and (
           jsonb_typeof(item_value->'route') <> 'string'
           or char_length(btrim(item_value->>'route')) not between 1 and 100
         )
       )
       or (
         item_value ? 'frequency'
         and (
           jsonb_typeof(item_value->'frequency') <> 'string'
           or char_length(btrim(item_value->>'frequency')) not between 1 and 200
         )
       )
       or (
         item_value ? 'duration'
         and (
           jsonb_typeof(item_value->'duration') <> 'string'
           or char_length(btrim(item_value->>'duration')) not between 1 and 200
         )
       )
       or (
         item_value ? 'quantity'
         and (
           jsonb_typeof(item_value->'quantity') <> 'number'
           or (item_value->>'quantity')::numeric <= 0
           or (item_value->>'quantity')::numeric > 1000000
         )
       )
       or (
         item_value ? 'quantityUnit'
         and (
           jsonb_typeof(item_value->'quantityUnit') <> 'string'
           or char_length(btrim(item_value->>'quantityUnit'))
             not between 1 and 80
         )
       )
       or (
         item_value ? 'refills'
         and (
           jsonb_typeof(item_value->'refills') <> 'number'
           or (item_value->>'refills') !~ '^[0-9]+$'
           or (item_value->>'refills')::integer not between 0 and 100
         )
       )
       or (
         item_value ? 'directions'
         and (
           jsonb_typeof(item_value->'directions') <> 'string'
           or char_length(btrim(item_value->>'directions'))
             not between 1 and 2000
         )
       )
    then
      raise exception 'manual prescription item % is invalid', item_row.ordinality
        using errcode = '22023';
    end if;

    select
      medicine.id,
      medicine.brand_name,
      medicine.generic_name,
      medicine.dosage_form,
      medicine.route
    into medicine_row
    from public.medicines medicine
    where medicine.id = (item_value->>'medicineId')::uuid
      and medicine.status = 'active'::public.medicine_record_status
      and medicine.deleted_at is null;

    if not found then
      raise exception 'manual prescription item % does not reference an active medicine',
        item_row.ordinality
        using errcode = '23503';
    end if;

    normalized_items := normalized_items || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'medicineId', medicine_row.id,
        'enteredMedicineName',
          medicine_row.brand_name || ' (' || medicine_row.generic_name || ')',
        'brandName', medicine_row.brand_name,
        'genericName', medicine_row.generic_name,
        'dosageForm', medicine_row.dosage_form,
        'strength', btrim(item_value->>'strength'),
        'dosage', btrim(item_value->>'dosage'),
        'route', coalesce(
          nullif(btrim(item_value->>'route'), ''),
          medicine_row.route
        ),
        'frequency', nullif(btrim(item_value->>'frequency'), ''),
        'duration', nullif(btrim(item_value->>'duration'), ''),
        'quantity', item_value->'quantity',
        'quantityUnit', nullif(btrim(item_value->>'quantityUnit'), ''),
        'refills', item_value->'refills',
        'directions', nullif(btrim(item_value->>'directions'), ''),
        'manualOverride', true,
        'confidence', 1
      ))
    );
  end loop;

  return normalized_items;
end;
$$;

revoke all on function public._normalize_manual_prescription_items(jsonb)
  from public;

create or replace function public._replace_manual_prescription_items(
  target_prescription_id uuid,
  normalized_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.prescription_items
  where prescription_id = target_prescription_id;

  insert into public.prescription_items (
    prescription_id, line_number, medicine_id, raw_medicine_text, strength,
    dosage, route, frequency, duration, quantity, quantity_unit, refills,
    prescriber_instructions
  )
  select
    target_prescription_id,
    item.ordinality::integer,
    (item.value->>'medicineId')::uuid,
    item.value->>'enteredMedicineName',
    item.value->>'strength',
    item.value->>'dosage',
    item.value->>'route',
    item.value->>'frequency',
    item.value->>'duration',
    (item.value->>'quantity')::numeric,
    item.value->>'quantityUnit',
    (item.value->>'refills')::integer,
    item.value->>'directions'
  from jsonb_array_elements(normalized_items)
    with ordinality item(value, ordinality);
end;
$$;

revoke all on function public._replace_manual_prescription_items(uuid, jsonb)
  from public;

create or replace function public._submit_manual_prescription(
  target_organization_id uuid,
  target_patient_id uuid,
  target_prescription_id uuid,
  normalized_items jsonb,
  target_content_sha256 text,
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
  prescription_row record;
  existing_event record;
  pipeline_definition_id uuid;
  review_definition_id uuid;
  pipeline_workflow_id uuid;
  review_workflow_id uuid;
  created_extraction_id uuid;
  created_validation_id uuid;
  created_evidence_id uuid;
  structured_output jsonb;
  evidence_document jsonb;
  evidence_hash text;
begin
  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':submitted';

  if found then
    if existing_event.payload->>'contentSha256'
       is distinct from target_content_sha256
    then
      raise exception 'manual prescription submission idempotency conflict'
        using errcode = '23505';
    end if;

    return (
      select jsonb_build_object(
        'prescriptionId', prescription.id,
        'status', prescription.status,
        'version', prescription.version,
        'reviewId', validation.id,
        'workflowId', extraction.pipeline_workflow_run_id
      )
      from public.prescriptions prescription
      join public.prescription_extractions extraction
        on extraction.prescription_id = prescription.id
       and extraction.organization_id = prescription.organization_id
      join public.clinical_validations validation
        on validation.prescription_id = prescription.id
       and validation.organization_id = prescription.organization_id
      where prescription.id = target_prescription_id
        and prescription.organization_id = target_organization_id
      order by validation.created_at desc
      limit 1
    );
  end if;

  select prescription.* into strict prescription_row
  from public.prescriptions prescription
  where prescription.id = target_prescription_id
    and prescription.organization_id = target_organization_id
    and prescription.patient_id = target_patient_id
    and prescription.source = 'manual'::public.prescription_source
    and prescription.status = 'received'::public.prescription_status
    and prescription.deleted_at is null
  for update;

  if exists (
    select 1
    from public.prescription_extractions extraction
    where extraction.prescription_id = target_prescription_id
      and extraction.organization_id = target_organization_id
  ) then
    raise exception 'manual prescription has already been submitted'
      using errcode = '23505';
  end if;

  perform public._ensure_clinical_workflow_definitions(
    target_organization_id,
    auth.uid()
  );

  select definition.id into strict pipeline_definition_id
  from public.workflow_definitions definition
  where definition.organization_id = target_organization_id
    and definition.name = 'ML-CPP-001'
    and definition.version = 1;

  select definition.id into strict review_definition_id
  from public.workflow_definitions definition
  where definition.organization_id = target_organization_id
    and definition.name = 'ML-WF-005'
    and definition.version = 1;

  select jsonb_build_object(
    'items',
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'medicineName', jsonb_build_object(
          'value', item.value->>'enteredMedicineName',
          'confidence', 1
        ),
        'strength', jsonb_build_object(
          'value', item.value->>'strength',
          'confidence', 1
        ),
        'dosage', jsonb_build_object(
          'value', item.value->>'dosage',
          'confidence', 1
        ),
        'quantity',
          case
            when item.value ? 'quantity'
              then jsonb_build_object(
                'value', item.value->>'quantity',
                'confidence', 1
              )
            else null
          end,
        'refills',
          case
            when item.value ? 'refills'
              then jsonb_build_object(
                'value', item.value->>'refills',
                'confidence', 1
              )
            else null
          end
      ))
      order by item.ordinality
    ),
    'overallConfidence',
    1
  )
  into structured_output
  from jsonb_array_elements(normalized_items)
    with ordinality item(value, ordinality);

  if prescription_row.prescriber_name is not null then
    structured_output := structured_output || jsonb_build_object(
      'prescriberName',
      jsonb_build_object(
        'value', prescription_row.prescriber_name,
        'confidence', 1
      )
    );
  end if;

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, status, subject_type,
    subject_reference, input_reference, current_step, previous_step,
    next_step, idempotency_key, correlation_id, started_at, created_by
  ) values (
    target_organization_id,
    pipeline_definition_id,
    'waiting',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'contentSha256', target_content_sha256,
      'itemCount', jsonb_array_length(normalized_items),
      'source', 'manual'
    ),
    'pharmacist_review',
    'clinical_validation',
    null,
    target_idempotency_key || ':pipeline',
    target_correlation_id,
    now(),
    auth.uid()
  )
  returning id into pipeline_workflow_id;

  insert into public.prescription_extractions (
    organization_id, prescription_id, status, provider, model,
    correlation_id, raw_output, overall_confidence, started_at, completed_at,
    pipeline_workflow_run_id
  ) values (
    target_organization_id,
    target_prescription_id,
    'completed',
    'manual-entry',
    'patient-entry-v1',
    target_correlation_id,
    structured_output,
    1,
    now(),
    now(),
    pipeline_workflow_id
  )
  returning id into created_extraction_id;

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, parent_workflow_run_id, status,
    subject_type, subject_reference, input_reference, current_step,
    previous_step, next_step, idempotency_key, correlation_id, started_at,
    created_by
  ) values (
    target_organization_id,
    review_definition_id,
    pipeline_workflow_id,
    'waiting',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'extractionId', created_extraction_id,
      'contentSha256', target_content_sha256
    ),
    'human_review',
    'initialized',
    null,
    target_idempotency_key || ':review',
    target_correlation_id,
    now(),
    auth.uid()
  )
  returning id into review_workflow_id;

  insert into public.clinical_validations (
    organization_id, prescription_id, status, summary, correlation_id,
    workflow_run_id
  ) values (
    target_organization_id,
    target_prescription_id,
    'pending',
    'Patient-entered prescription requires independent pharmacist review.',
    target_correlation_id,
    review_workflow_id
  )
  returning id into created_validation_id;

  insert into public.clinical_findings (
    validation_id, kind, severity, title, detail, evidence, confidence,
    requires_acknowledgement
  ) values (
    created_validation_id,
    'other',
    'informational',
    'Manual prescription entry',
    'Verify every patient-entered medicine and direction against the original prescription before approval.',
    jsonb_build_array(jsonb_build_object('code', 'manual_entry')),
    1,
    false
  );

  evidence_document := jsonb_build_object(
    'schemaVersion', 1,
    'prescription',
    jsonb_strip_nulls(jsonb_build_object(
      'id', target_prescription_id,
      'patientId', target_patient_id,
      'source', 'manual',
      'prescriberName', prescription_row.prescriber_name,
      'facilityName', prescription_row.facility_name,
      'notes', prescription_row.patient_notes,
      'prescribedAt', prescription_row.prescribed_at,
      'expiresAt', prescription_row.expires_at
    )),
    'manualEntry',
    jsonb_build_object(
      'items', normalized_items,
      'contentSha256', target_content_sha256
    ),
    'structuredExtraction',
    structured_output,
    'extractionConfidence',
    1,
    'validationFindings',
    jsonb_build_array(jsonb_build_object(
      'code', 'manual_entry',
      'severity', 'informational',
      'title', 'Manual prescription entry',
      'detail',
        'Verify every patient-entered medicine and direction against the original prescription before approval.',
      'confidence', 1,
      'requiresAcknowledgement', false
    )),
    'runtime',
    jsonb_build_object(
      'pipelineId', pipeline_workflow_id,
      'reviewWorkflowId', review_workflow_id,
      'correlationId', target_correlation_id
    )
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
    target_organization_id,
    target_prescription_id,
    created_extraction_id,
    created_validation_id,
    pipeline_workflow_id,
    1,
    evidence_document,
    evidence_hash
  )
  returning id into created_evidence_id;

  update public.prescriptions
  set status = 'needs_review'
  where id = target_prescription_id
    and organization_id = target_organization_id;

  update public.workflow_runs
  set output_reference = jsonb_build_object(
        'validationId', created_validation_id,
        'evidenceId', created_evidence_id,
        'contentSha256', evidence_hash
      )
  where id = pipeline_workflow_id
    and organization_id = target_organization_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values
  (
    target_organization_id,
    pipeline_workflow_id,
    'workflow.started.v1',
    'manual_intake',
    auth.uid(),
    target_idempotency_key || ':pipeline-started',
    jsonb_build_object(
      'source', 'manual',
      'itemCount', jsonb_array_length(normalized_items)
    )
  ),
  (
    target_organization_id,
    pipeline_workflow_id,
    'workflow.waiting-for-human.v1',
    'pharmacist_review',
    auth.uid(),
    target_idempotency_key || ':pipeline-waiting',
    jsonb_build_object(
      'reviewId', created_validation_id,
      'reviewWorkflowId', review_workflow_id
    )
  ),
  (
    target_organization_id,
    review_workflow_id,
    'workflow.waiting-for-human.v1',
    'human_review',
    auth.uid(),
    target_idempotency_key || ':review-waiting',
    jsonb_build_object(
      'reviewId', created_validation_id,
      'evidenceId', created_evidence_id
    )
  );

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values
  (
    target_organization_id,
    'prescription.manual-submitted.v1',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', target_prescription_id,
      'extractionId', created_extraction_id,
      'pipelineId', pipeline_workflow_id,
      'workflowId', review_workflow_id,
      'validationId', created_validation_id,
      'contentSha256', target_content_sha256
    ),
    target_correlation_id,
    target_request_id,
    pipeline_workflow_id::text,
    target_idempotency_key || ':submitted'
  ),
  (
    target_organization_id,
    'prescription.clinical-packet.generated.v1',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', target_prescription_id,
      'extractionId', created_extraction_id,
      'pipelineId', pipeline_workflow_id,
      'workflowId', review_workflow_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id,
      'contentSha256', evidence_hash
    ),
    target_correlation_id,
    target_request_id,
    review_workflow_id::text,
    target_idempotency_key || ':clinical-packet-generated'
  ),
  (
    target_organization_id,
    'prescription.pharmacist-review.requested.v1',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', target_prescription_id,
      'extractionId', created_extraction_id,
      'pipelineId', pipeline_workflow_id,
      'workflowId', review_workflow_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id
    ),
    target_correlation_id,
    target_request_id,
    review_workflow_id::text,
    target_idempotency_key || ':pharmacist-review-requested'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    target_organization_id,
    'prescription.lifecycle',
    'user',
    auth.uid()::text,
    'prescription',
    target_prescription_id::text,
    'manual.submit',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-submitted',
    pipeline_workflow_id::text,
    'web',
    jsonb_build_object(
      'extractionId', created_extraction_id,
      'validationId', created_validation_id,
      'evidenceId', created_evidence_id,
      'contentSha256', target_content_sha256,
      'itemCount', jsonb_array_length(normalized_items)
    )
  );

  return jsonb_build_object(
    'prescriptionId', target_prescription_id,
    'status', 'needs_review',
    'version', prescription_row.version,
    'reviewId', created_validation_id,
    'workflowId', pipeline_workflow_id
  );
end;
$$;

revoke all on function public._submit_manual_prescription(
  uuid, uuid, uuid, jsonb, text, text, text, text
) from public;

create or replace function public.create_manual_prescription(
  target_organization_id uuid,
  target_patient_id uuid,
  target_items jsonb,
  target_prescriber_name text,
  target_facility_name text,
  target_notes text,
  target_prescribed_at timestamptz,
  target_expires_at timestamptz,
  target_submit boolean,
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
  normalized_items jsonb;
  normalized_input jsonb;
  content_hash text;
  existing_event record;
  definition_id uuid;
  created_prescription_id uuid;
  intake_workflow_id uuid;
begin
  if auth.uid() is null
     or auth.uid() <> target_patient_id
     or not public.is_organization_member(target_organization_id)
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
     or (
       target_prescriber_name is not null
       and char_length(btrim(target_prescriber_name)) not between 1 and 240
     )
     or (
       target_facility_name is not null
       and char_length(btrim(target_facility_name)) not between 1 and 240
     )
     or (
       target_notes is not null
       and char_length(btrim(target_notes)) not between 1 and 4000
     )
     or (
       target_expires_at is not null
       and target_prescribed_at is not null
       and target_expires_at < target_prescribed_at
     )
  then
    raise exception 'invalid manual prescription context'
      using errcode = '42501';
  end if;

  normalized_items := public._normalize_manual_prescription_items(target_items);
  normalized_input := jsonb_strip_nulls(jsonb_build_object(
    'items', normalized_items,
    'prescriberName', nullif(btrim(target_prescriber_name), ''),
    'facilityName', nullif(btrim(target_facility_name), ''),
    'notes', nullif(btrim(target_notes), ''),
    'prescribedAt', target_prescribed_at,
    'expiresAt', target_expires_at,
    'submit', target_submit
  ));
  content_hash := encode(
    public.digest(
      convert_to(normalized_input::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':created';

  if found then
    if existing_event.payload->>'contentSha256' is distinct from content_hash
    then
      raise exception 'manual prescription idempotency conflict'
        using errcode = '23505';
    end if;

    return (
      select jsonb_build_object(
        'prescriptionId', prescription.id,
        'status', prescription.status,
        'version', prescription.version,
        'reviewId', validation.id,
        'workflowId', coalesce(
          extraction.pipeline_workflow_run_id,
          intake.id
        )
      )
      from public.prescriptions prescription
      left join public.prescription_extractions extraction
        on extraction.prescription_id = prescription.id
       and extraction.organization_id = prescription.organization_id
      left join public.clinical_validations validation
        on validation.prescription_id = prescription.id
       and validation.organization_id = prescription.organization_id
      left join public.workflow_runs intake
        on intake.organization_id = prescription.organization_id
       and intake.subject_type = 'prescription'
       and intake.subject_reference = prescription.id::text
       and intake.idempotency_key =
         target_idempotency_key || ':manual-intake'
      where prescription.id =
          (existing_event.payload->>'prescriptionId')::uuid
        and prescription.organization_id = target_organization_id
      order by validation.created_at desc nulls last
      limit 1
    );
  end if;

  insert into public.workflow_definitions (
    organization_id, name, version, definition, definition_sha256,
    is_active, created_by
  ) values (
    target_organization_id,
    'ML-WF-006',
    1,
    '{"capabilityId":"ML-CAP-006","kind":"workflow","source":"manual","steps":["validated","catalog_resolved","stored","submitted"],"version":1}'::jsonb,
    encode(
      public.digest(
        convert_to(
          '{"capabilityId":"ML-CAP-006","kind":"workflow","source":"manual","steps":["validated","catalog_resolved","stored","submitted"],"version":1}',
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

  select definition.id into strict definition_id
  from public.workflow_definitions definition
  where definition.organization_id = target_organization_id
    and definition.name = 'ML-WF-006'
    and definition.version = 1;

  insert into public.prescriptions (
    organization_id, patient_id, source, status, prescribed_at, expires_at,
    uploaded_by, prescriber_name, facility_name, patient_notes
  ) values (
    target_organization_id,
    target_patient_id,
    'manual',
    'received',
    target_prescribed_at,
    target_expires_at,
    auth.uid(),
    nullif(btrim(target_prescriber_name), ''),
    nullif(btrim(target_facility_name), ''),
    nullif(btrim(target_notes), '')
  )
  returning id into created_prescription_id;

  perform public._replace_manual_prescription_items(
    created_prescription_id,
    normalized_items
  );

  insert into public.workflow_runs (
    organization_id, workflow_definition_id, status, subject_type,
    subject_reference, input_reference, output_reference, current_step,
    idempotency_key, correlation_id, started_at, completed_at, created_by
  ) values (
    target_organization_id,
    definition_id,
    'completed',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'contentSha256', content_hash,
      'itemCount', jsonb_array_length(normalized_items),
      'submit', target_submit
    ),
    jsonb_build_object(
      'prescriptionId', created_prescription_id,
      'status', 'received'
    ),
    'completed',
    target_idempotency_key || ':manual-intake',
    target_correlation_id,
    now(),
    now(),
    auth.uid()
  )
  returning id into intake_workflow_id;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values
  (
    target_organization_id,
    intake_workflow_id,
    'workflow.started.v1',
    'validated',
    auth.uid(),
    target_idempotency_key || ':manual-intake-started',
    jsonb_build_object('capabilityId', 'ML-CAP-006')
  ),
  (
    target_organization_id,
    intake_workflow_id,
    'workflow.completed.v1',
    'completed',
    auth.uid(),
    target_idempotency_key || ':manual-intake-completed',
    jsonb_build_object(
      'prescriptionId', created_prescription_id,
      'contentSha256', content_hash
    )
  );

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values (
    target_organization_id,
    'prescription.manual-created.v1',
    'prescription',
    created_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', created_prescription_id,
      'workflowId', intake_workflow_id,
      'contentSha256', content_hash,
      'status', 'received'
    ),
    target_correlation_id,
    target_request_id,
    intake_workflow_id::text,
    target_idempotency_key || ':created'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    target_organization_id,
    'prescription.lifecycle',
    'user',
    auth.uid()::text,
    'prescription',
    created_prescription_id::text,
    'manual.create',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-created',
    intake_workflow_id::text,
    'web',
    jsonb_build_object(
      'contentSha256', content_hash,
      'itemCount', jsonb_array_length(normalized_items),
      'submitted', target_submit
    )
  );

  if target_submit then
    return public._submit_manual_prescription(
      target_organization_id,
      target_patient_id,
      created_prescription_id,
      normalized_items,
      content_hash,
      target_idempotency_key,
      target_correlation_id,
      target_request_id
    );
  end if;

  return jsonb_build_object(
    'prescriptionId', created_prescription_id,
    'status', 'received',
    'version', 1,
    'reviewId', null,
    'workflowId', intake_workflow_id
  );
end;
$$;

revoke all on function public.create_manual_prescription(
  uuid, uuid, jsonb, text, text, text, timestamptz, timestamptz,
  boolean, text, text, text
) from public;
grant execute on function public.create_manual_prescription(
  uuid, uuid, jsonb, text, text, text, timestamptz, timestamptz,
  boolean, text, text, text
) to authenticated;

create or replace function public.update_manual_prescription(
  target_organization_id uuid,
  target_patient_id uuid,
  target_prescription_id uuid,
  target_expected_version integer,
  target_items jsonb,
  target_prescriber_name text,
  target_facility_name text,
  target_notes text,
  target_prescribed_at timestamptz,
  target_expires_at timestamptz,
  target_submit boolean,
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
  prescription_row record;
  normalized_items jsonb;
  normalized_input jsonb;
  content_hash text;
  existing_event record;
  intake_workflow_id uuid;
begin
  if auth.uid() is null
     or auth.uid() <> target_patient_id
     or not public.is_organization_member(target_organization_id)
     or target_expected_version < 1
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
     or (
       target_prescriber_name is not null
       and char_length(btrim(target_prescriber_name)) not between 1 and 240
     )
     or (
       target_facility_name is not null
       and char_length(btrim(target_facility_name)) not between 1 and 240
     )
     or (
       target_notes is not null
       and char_length(btrim(target_notes)) not between 1 and 4000
     )
     or (
       target_expires_at is not null
       and target_prescribed_at is not null
       and target_expires_at < target_prescribed_at
     )
  then
    raise exception 'invalid manual prescription update context'
      using errcode = '42501';
  end if;

  normalized_items := public._normalize_manual_prescription_items(target_items);
  normalized_input := jsonb_strip_nulls(jsonb_build_object(
    'prescriptionId', target_prescription_id,
    'expectedVersion', target_expected_version,
    'items', normalized_items,
    'prescriberName', nullif(btrim(target_prescriber_name), ''),
    'facilityName', nullif(btrim(target_facility_name), ''),
    'notes', nullif(btrim(target_notes), ''),
    'prescribedAt', target_prescribed_at,
    'expiresAt', target_expires_at,
    'submit', target_submit
  ));
  content_hash := encode(
    public.digest(
      convert_to(normalized_input::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':updated';

  if found then
    if existing_event.payload->>'contentSha256' is distinct from content_hash
    then
      raise exception 'manual prescription update idempotency conflict'
        using errcode = '23505';
    end if;

    return (
      select jsonb_build_object(
        'prescriptionId', prescription.id,
        'status', prescription.status,
        'version', prescription.version,
        'reviewId', validation.id,
        'workflowId', coalesce(
          extraction.pipeline_workflow_run_id,
          intake.id
        )
      )
      from public.prescriptions prescription
      left join public.prescription_extractions extraction
        on extraction.prescription_id = prescription.id
       and extraction.organization_id = prescription.organization_id
      left join public.clinical_validations validation
        on validation.prescription_id = prescription.id
       and validation.organization_id = prescription.organization_id
      left join public.workflow_runs intake
        on intake.organization_id = prescription.organization_id
       and intake.subject_type = 'prescription'
       and intake.subject_reference = prescription.id::text
      where prescription.id = target_prescription_id
        and prescription.organization_id = target_organization_id
      order by validation.created_at desc nulls last, intake.created_at
      limit 1
    );
  end if;

  select prescription.* into strict prescription_row
  from public.prescriptions prescription
  where prescription.id = target_prescription_id
    and prescription.organization_id = target_organization_id
    and prescription.patient_id = target_patient_id
    and prescription.source = 'manual'::public.prescription_source
    and prescription.status = 'received'::public.prescription_status
    and prescription.deleted_at is null
  for update;

  if prescription_row.version <> target_expected_version then
    raise exception 'manual prescription version conflict'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.prescription_extractions extraction
    where extraction.prescription_id = target_prescription_id
      and extraction.organization_id = target_organization_id
  ) then
    raise exception 'submitted manual prescription is immutable'
      using errcode = '42501';
  end if;

  update public.prescriptions
  set prescriber_name = nullif(btrim(target_prescriber_name), ''),
      facility_name = nullif(btrim(target_facility_name), ''),
      patient_notes = nullif(btrim(target_notes), ''),
      prescribed_at = target_prescribed_at,
      expires_at = target_expires_at,
      version = version + 1
  where id = target_prescription_id
    and organization_id = target_organization_id;

  perform public._replace_manual_prescription_items(
    target_prescription_id,
    normalized_items
  );

  select run.id into intake_workflow_id
  from public.workflow_runs run
  join public.workflow_definitions definition
    on definition.id = run.workflow_definition_id
   and definition.organization_id = run.organization_id
  where run.organization_id = target_organization_id
    and run.subject_type = 'prescription'
    and run.subject_reference = target_prescription_id::text
    and definition.name = 'ML-WF-006'
  order by run.created_at
  limit 1;

  insert into public.workflow_run_events (
    organization_id, workflow_run_id, event_type, step_name, actor_id,
    idempotency_key, detail
  ) values (
    target_organization_id,
    intake_workflow_id,
    'workflow.input.updated.v1',
    'manual_draft',
    auth.uid(),
    target_idempotency_key || ':manual-draft-updated',
    jsonb_build_object(
      'version', target_expected_version + 1,
      'contentSha256', content_hash
    )
  );

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, idempotency_key
  ) values (
    target_organization_id,
    'prescription.manual-draft-updated.v1',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', target_prescription_id,
      'workflowId', intake_workflow_id,
      'contentSha256', content_hash,
      'version', target_expected_version + 1
    ),
    target_correlation_id,
    target_request_id,
    intake_workflow_id::text,
    target_idempotency_key || ':updated'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, workflow_id, source_channel, metadata
  ) values (
    target_organization_id,
    'prescription.lifecycle',
    'user',
    auth.uid()::text,
    'prescription',
    target_prescription_id::text,
    'manual.update',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-updated',
    intake_workflow_id::text,
    'web',
    jsonb_build_object(
      'contentSha256', content_hash,
      'version', target_expected_version + 1,
      'itemCount', jsonb_array_length(normalized_items),
      'submitted', target_submit
    )
  );

  if target_submit then
    return public._submit_manual_prescription(
      target_organization_id,
      target_patient_id,
      target_prescription_id,
      normalized_items,
      content_hash,
      target_idempotency_key,
      target_correlation_id,
      target_request_id
    );
  end if;

  return jsonb_build_object(
    'prescriptionId', target_prescription_id,
    'status', 'received',
    'version', target_expected_version + 1,
    'reviewId', null,
    'workflowId', intake_workflow_id
  );
end;
$$;

revoke all on function public.update_manual_prescription(
  uuid, uuid, uuid, integer, jsonb, text, text, text, timestamptz,
  timestamptz, boolean, text, text, text
) from public;
grant execute on function public.update_manual_prescription(
  uuid, uuid, uuid, integer, jsonb, text, text, text, timestamptz,
  timestamptz, boolean, text, text, text
) to authenticated;

create or replace function public.delete_manual_prescription_draft(
  target_organization_id uuid,
  target_patient_id uuid,
  target_prescription_id uuid,
  target_expected_version integer,
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
  prescription_row record;
  existing_event record;
begin
  if auth.uid() is null
     or auth.uid() <> target_patient_id
     or not public.is_organization_member(target_organization_id)
     or target_expected_version < 1
     or btrim(target_idempotency_key) = ''
     or char_length(target_idempotency_key) > 200
     or btrim(target_correlation_id) = ''
     or btrim(target_request_id) = ''
  then
    raise exception 'invalid manual prescription delete context'
      using errcode = '42501';
  end if;

  select event.payload into existing_event
  from public.runtime_outbox_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key || ':deleted';

  if found then
    if existing_event.payload->>'prescriptionId'
       is distinct from target_prescription_id::text
    then
      raise exception 'manual prescription delete idempotency conflict'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'prescriptionId', target_prescription_id,
      'deleted', true
    );
  end if;

  select prescription.* into strict prescription_row
  from public.prescriptions prescription
  where prescription.id = target_prescription_id
    and prescription.organization_id = target_organization_id
    and prescription.patient_id = target_patient_id
    and prescription.source = 'manual'::public.prescription_source
    and prescription.status = 'received'::public.prescription_status
    and prescription.deleted_at is null
  for update;

  if prescription_row.version <> target_expected_version then
    raise exception 'manual prescription version conflict'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.prescription_extractions extraction
    where extraction.prescription_id = target_prescription_id
      and extraction.organization_id = target_organization_id
  ) then
    raise exception 'submitted manual prescription cannot be deleted'
      using errcode = '42501';
  end if;

  update public.prescriptions
  set deleted_at = now(),
      version = version + 1
  where id = target_prescription_id
    and organization_id = target_organization_id;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  ) values (
    target_organization_id,
    'prescription.manual-draft-deleted.v1',
    'prescription',
    target_prescription_id::text,
    jsonb_build_object(
      'tenantId', target_organization_id,
      'prescriptionId', target_prescription_id,
      'version', target_expected_version + 1
    ),
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':deleted'
  );

  insert into public.governance_audit_events (
    organization_id, event_type, actor_type, actor_reference,
    resource_type, resource_id, action, outcome, correlation_id,
    request_id, idempotency_key, source_channel, metadata
  ) values (
    target_organization_id,
    'prescription.lifecycle',
    'user',
    auth.uid()::text,
    'prescription',
    target_prescription_id::text,
    'manual.delete',
    'success',
    target_correlation_id,
    target_request_id,
    target_idempotency_key || ':audit-deleted',
    'web',
    jsonb_build_object('version', target_expected_version + 1)
  );

  return jsonb_build_object(
    'prescriptionId', target_prescription_id,
    'deleted', true
  );
end;
$$;

revoke all on function public.delete_manual_prescription_draft(
  uuid, uuid, uuid, integer, text, text, text
) from public;
grant execute on function public.delete_manual_prescription_draft(
  uuid, uuid, uuid, integer, text, text, text
) to authenticated;

comment on function public.create_manual_prescription(
  uuid, uuid, jsonb, text, text, text, timestamptz, timestamptz,
  boolean, text, text, text
) is
  'Creates a patient-owned manual draft and optionally submits it into the immutable PI-1 pharmacist-review evidence chain.';
comment on function public.update_manual_prescription(
  uuid, uuid, uuid, integer, jsonb, text, text, text, timestamptz,
  timestamptz, boolean, text, text, text
) is
  'Atomically replaces an unsubmitted manual draft with optimistic concurrency and may submit it for pharmacist review.';

create or replace function public.list_patient_prescriptions(
  target_organization_id uuid,
  target_patient_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or auth.uid() <> target_patient_id
     or not public.is_organization_member(target_organization_id)
  then
    raise exception 'invalid patient prescription context'
      using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', prescription.id,
        'source', prescription.source,
        'status', prescription.status,
        'reviewStatus', (
          select validation.status
          from public.clinical_validations validation
          where validation.organization_id = prescription.organization_id
            and validation.prescription_id = prescription.id
          order by validation.created_at desc
          limit 1
        ),
        'prescriberName', prescription.prescriber_name,
        'facilityName', prescription.facility_name,
        'prescribedAt', prescription.prescribed_at,
        'expiresAt', prescription.expires_at,
        'version', prescription.version,
        'createdAt', prescription.created_at,
        'updatedAt', prescription.updated_at
      )
      order by prescription.created_at desc
    )
    from (
      select candidate.*
      from public.prescriptions candidate
      where candidate.organization_id = target_organization_id
        and candidate.patient_id = target_patient_id
        and candidate.deleted_at is null
      order by candidate.created_at desc
      limit 100
    ) prescription
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_patient_prescription(
  target_organization_id uuid,
  target_patient_id uuid,
  target_prescription_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  prescription_row record;
begin
  if auth.uid() is null
     or auth.uid() <> target_patient_id
     or not public.is_organization_member(target_organization_id)
  then
    raise exception 'invalid patient prescription context'
      using errcode = '42501';
  end if;

  select prescription.* into prescription_row
  from public.prescriptions prescription
  where prescription.id = target_prescription_id
    and prescription.organization_id = target_organization_id
    and prescription.patient_id = target_patient_id
    and prescription.deleted_at is null;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', prescription_row.id,
    'patientId', prescription_row.patient_id,
    'source', prescription_row.source,
    'status', prescription_row.status,
    'reviewStatus', (
      select validation.status
      from public.clinical_validations validation
      where validation.organization_id = target_organization_id
        and validation.prescription_id = target_prescription_id
      order by validation.created_at desc
      limit 1
    ),
    'prescriberName', prescription_row.prescriber_name,
    'facilityName', prescription_row.facility_name,
    'notes', prescription_row.patient_notes,
    'prescribedAt', prescription_row.prescribed_at,
    'expiresAt', prescription_row.expires_at,
    'version', prescription_row.version,
    'createdAt', prescription_row.created_at,
    'updatedAt', prescription_row.updated_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'lineNumber', item.line_number,
          'medicineId', item.medicine_id,
          'enteredMedicineName', item.raw_medicine_text,
          'brandName', medicine.brand_name,
          'genericName', medicine.generic_name,
          'strength', item.strength,
          'dosage', item.dosage,
          'dosageForm', medicine.dosage_form,
          'route', item.route,
          'frequency', item.frequency,
          'duration', item.duration,
          'quantity', item.quantity,
          'quantityUnit', item.quantity_unit,
          'refills', item.refills,
          'directions', item.prescriber_instructions,
          'manualOverride',
            prescription_row.source = 'manual'::public.prescription_source,
          'confidence', (
            select min(field.confidence)
            from public.prescription_extracted_fields field
            join public.prescription_extractions extraction
              on extraction.id = field.extraction_id
            where extraction.organization_id = target_organization_id
              and extraction.prescription_id = target_prescription_id
              and field.field_path like
                '/items/' || (item.line_number - 1)::text || '/%'
          )
        )
        order by item.line_number
      )
      from public.prescription_items item
      left join public.medicines medicine on medicine.id = item.medicine_id
      where item.prescription_id = target_prescription_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_patient_prescriptions(uuid, uuid)
  from public;
grant execute on function public.list_patient_prescriptions(uuid, uuid)
  to authenticated;
revoke all on function public.get_patient_prescription(uuid, uuid, uuid)
  from public;
grant execute on function public.get_patient_prescription(uuid, uuid, uuid)
  to authenticated;

comment on function public.list_patient_prescriptions(uuid, uuid) is
  'Returns a patient-safe prescription history projection without clinical evidence, rationale, storage paths, or unapproved recommendations.';
comment on function public.get_patient_prescription(uuid, uuid, uuid) is
  'Returns one patient-owned prescription and catalogue-linked items while retaining clinical evidence behind pharmacist-only RLS.';
