-- Wave 3: deduplicate clinical validation retries.
--
-- Found by PR review (Codex): `record_clinical_validation`
-- (migration 202607290009) inserts a fresh `clinical_validations` row and a
-- fresh set of `clinical_findings` on every call, with no idempotency
-- check before the insert -- unlike every other atomic use case this
-- session has built. `target_idempotency_key` was only ever passed
-- through to `record_runtime_evidence`, whose own `on conflict` handling
-- dedupes the outbox/audit rows but does nothing for the business rows
-- inserted before it runs. A client retry of
-- `POST /prescriptions/{id}/validate` after a dropped response (the exact
-- scenario every other idempotency key in this schema exists to handle)
-- creates duplicate clinical-review work for a pharmacist to wade through.
--
-- `clinical_validations` never had an idempotency-key column of its own to
-- check against -- adding one now, following the same nullable-column +
-- partial-unique-index pattern `mar_audit_events_idempotency_idx`
-- (migration 202607270003) already established, rather than inventing a
-- new one.

alter table public.clinical_validations
  add column idempotency_key text;

create unique index clinical_validations_idempotency_idx
  on public.clinical_validations(organization_id, idempotency_key)
  where idempotency_key is not null;

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
  existing public.clinical_validations;
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

  -- Idempotent replay: a repeated call with the same key returns the
  -- already-recorded validation (and its findings, already inserted by
  -- the first call) rather than inserting a second copy of both.
  select * into existing from public.clinical_validations
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    return existing;
  end if;

  -- Automated rules only ever produce a preliminary result; a validation
  -- always lands 'pending' so a licensed pharmacist must review and
  -- transition it (matches ClinicalValidationService.requiresPharmacistReview,
  -- which is always true).
  insert into public.clinical_validations (
    organization_id, prescription_id, status, summary, correlation_id,
    idempotency_key
  ) values (
    target_organization_id, target_prescription_id, 'pending', target_summary,
    target_correlation_id, target_idempotency_key
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

comment on function public.record_clinical_validation is
  'Atomic Wave 2 use case: commits a clinical validation, its findings, and runtime evidence in one transaction. Idempotent on (organization_id, idempotency_key) via clinical_validations_idempotency_idx -- a retried call returns the original validation rather than inserting duplicate clinical-review work.';
