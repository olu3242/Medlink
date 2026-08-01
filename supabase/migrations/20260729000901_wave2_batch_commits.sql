-- Wave 2 batch wiring: atomic use-case commits for Batch 2.2 (Medication
-- Equivalency tenant review), Batch 2.3 (Prescription Intelligence
-- extraction), and Batch 2.4 (Clinical Intelligence validation).
--
-- Each of these use cases writes to more than one table (a parent record plus
-- child rows) and must record runtime evidence in the same transaction, so
-- they follow the same SECURITY DEFINER + record_runtime_evidence pattern
-- introduced in 202607290008 for Wave 2 catalog/prescription mutations.

create or replace function public.review_medicine_equivalence(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_equivalence_id uuid,
  target_status public.review_status,
  target_review_notes text
)
returns public.tenant_equivalence_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewed public.tenant_equivalence_reviews;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id, array['pharmacist']::public.member_role[]
  ) then
    raise exception 'Equivalence review requires a pharmacist';
  end if;
  if target_status = 'pending' then
    raise exception 'A review decision cannot be pending';
  end if;
  if not exists (
    select 1 from public.medicine_equivalences
    where id = target_equivalence_id and status = 'active' and deleted_at is null
  ) then
    raise exception 'Medicine equivalence not found';
  end if;

  insert into public.tenant_equivalence_reviews (
    organization_id, equivalence_id, status, reviewed_by, review_notes,
    reviewed_at
  ) values (
    target_organization_id, target_equivalence_id, target_status,
    target_actor_id, target_review_notes, now()
  )
  on conflict (organization_id, equivalence_id) do update set
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    review_notes = excluded.review_notes,
    reviewed_at = excluded.reviewed_at
  returning * into reviewed;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'equivalents.review',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'medicine_equivalence_review', reviewed.id::text, null,
    jsonb_build_object('status', reviewed.status),
    null, null, target_channel, 'equivalence.reviewed',
    jsonb_build_object(
      'equivalenceId', target_equivalence_id, 'reviewId', reviewed.id
    )
  );

  return reviewed;
end;
$$;

revoke all on function public.review_medicine_equivalence(
  uuid, uuid, text, text, text, text, uuid, public.review_status, text
) from public;
grant execute on function public.review_medicine_equivalence(
  uuid, uuid, text, text, text, text, uuid, public.review_status, text
) to authenticated;

create or replace function public.record_clinical_validation(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_prescription_id uuid,
  target_summary text,
  target_findings jsonb
)
returns public.clinical_validations
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.clinical_validations;
  finding jsonb;
  finding_kind public.clinical_finding_kind;
  finding_severity public.clinical_severity;
  requires_ack boolean;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id, array['pharmacist']::public.member_role[]
  ) then
    raise exception 'Clinical validation requires a pharmacist';
  end if;
  if not exists (
    select 1 from public.prescriptions
    where id = target_prescription_id and organization_id = target_organization_id
      and deleted_at is null
  ) then
    raise exception 'Prescription not found';
  end if;

  -- Automated rules only ever produce a preliminary result; a validation
  -- always lands 'pending' so a licensed pharmacist must review and
  -- transition it (matches ClinicalValidationService.requiresPharmacistReview,
  -- which is always true).
  insert into public.clinical_validations (
    organization_id, prescription_id, status, summary, correlation_id
  ) values (
    target_organization_id, target_prescription_id, 'pending', target_summary,
    target_correlation_id
  )
  returning * into created;

  for finding in select * from jsonb_array_elements(coalesce(target_findings, '[]'::jsonb))
  loop
    -- packages/clinical's ValidationFinding.code is an open string (new rules
    -- may not map to an existing clinical_finding_kind), so fall back to
    -- 'other' rather than reject an otherwise-valid finding.
    finding_kind := case finding->>'code'
      when 'duplicate_therapy' then 'duplicate_therapy'
      when 'allergy' then 'allergy'
      when 'interaction' then 'interaction'
      when 'dose' then 'dose'
      when 'controlled_substance' then 'controlled_substance'
      when 'illegible' then 'illegible'
      else 'other'
    end;
    -- packages/clinical's severity vocabulary (info/warning/critical) is
    -- coarser than clinical_severity (informational/low/moderate/high/
    -- critical); 'warning' maps to 'moderate' as the closest equivalent.
    finding_severity := case finding->>'severity'
      when 'info' then 'informational'
      when 'warning' then 'moderate'
      when 'critical' then 'critical'
      else 'moderate'
    end;
    requires_ack := coalesce((finding->>'requiresAcknowledgement')::boolean, false)
      or finding_severity in ('high', 'critical');

    insert into public.clinical_findings (
      validation_id, kind, severity, title, detail, evidence,
      requires_acknowledgement
    ) values (
      created.id, finding_kind, finding_severity,
      initcap(replace(coalesce(finding->>'code', 'other'), '_', ' ')),
      coalesce(finding->>'summary', ''),
      jsonb_build_array(jsonb_build_object('source', finding->>'source')),
      requires_ack
    );
  end loop;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'clinical.validations.record',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'clinical_validation', created.id::text, null,
    jsonb_build_object('status', created.status),
    null, null, target_channel, 'clinical_validation.recorded',
    jsonb_build_object('validationId', created.id, 'prescriptionId', target_prescription_id)
  );

  return created;
end;
$$;

revoke all on function public.record_clinical_validation(
  uuid, uuid, text, text, text, text, uuid, text, jsonb
) from public;
grant execute on function public.record_clinical_validation(
  uuid, uuid, text, text, text, text, uuid, text, jsonb
) to authenticated;

create or replace function public.record_prescription_extraction(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_prescription_id uuid,
  target_provider text,
  target_model text,
  target_overall_confidence numeric,
  target_fields jsonb
)
returns public.prescription_extractions
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.prescription_extractions;
  field jsonb;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['platform_admin', 'tenant_admin', 'pharmacist']::public.member_role[]
  ) then
    raise exception 'Prescription extraction requires clinical staff';
  end if;
  if not exists (
    select 1 from public.prescriptions
    where id = target_prescription_id and organization_id = target_organization_id
      and deleted_at is null
  ) then
    raise exception 'Prescription not found';
  end if;

  insert into public.prescription_extractions (
    organization_id, prescription_id, status, provider, model, correlation_id,
    overall_confidence, started_at, completed_at
  ) values (
    target_organization_id, target_prescription_id, 'completed', target_provider,
    target_model, target_correlation_id, target_overall_confidence, now(), now()
  )
  returning * into created;

  for field in select * from jsonb_array_elements(coalesce(target_fields, '[]'::jsonb))
  loop
    insert into public.prescription_extracted_fields (
      extraction_id, field_path, raw_value, normalized_value, confidence,
      needs_human_review
    ) values (
      created.id, field->>'fieldPath', field->>'rawValue',
      field->'normalizedValue', (field->>'confidence')::numeric,
      coalesce((field->>'needsHumanReview')::boolean, true)
    );
  end loop;

  -- An extraction never validates a prescription; it always routes the
  -- prescription to a human review queue regardless of confidence.
  update public.prescriptions set status = 'needs_review'
  where id = target_prescription_id and organization_id = target_organization_id;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'prescriptions.extract',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'prescription_extraction', created.id::text, null,
    jsonb_build_object(
      'status', created.status, 'overallConfidence', created.overall_confidence
    ),
    null, null, target_channel, 'prescription.extracted',
    jsonb_build_object(
      'extractionId', created.id, 'prescriptionId', target_prescription_id
    )
  );

  return created;
end;
$$;

revoke all on function public.record_prescription_extraction(
  uuid, uuid, text, text, text, text, uuid, text, text, numeric, jsonb
) from public;
grant execute on function public.record_prescription_extraction(
  uuid, uuid, text, text, text, text, uuid, text, text, numeric, jsonb
) to authenticated;

comment on function public.review_medicine_equivalence is
  'Atomic Wave 2 use case: commits a tenant pharmacist equivalence review decision and its runtime evidence in one transaction.';
comment on function public.record_clinical_validation is
  'Atomic Wave 2 use case: commits a clinical validation and its findings and runtime evidence in one transaction.';
comment on function public.record_prescription_extraction is
  'Atomic Wave 2 use case: commits a prescription extraction, its fields, the prescription review-state transition, and runtime evidence in one transaction.';
