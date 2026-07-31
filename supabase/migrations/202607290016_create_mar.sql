-- Wave 3: atomic Medication Access Request creation.
--
-- apps/patient/lib/application.ts's AccessApplication.createMar() has
-- always been a raw single-table insert with no runtime evidence commit --
-- exactly the gap docs/audit/RC1_BACKLOG.md's item 3 (S01.8) named and
-- deliberately deferred: "MAR, clinical review, and reservation mutations
-- remain non-atomic two-step calls and are Wave 3 scope." Reservation
-- creation closed in migration 202607290010; this closes MAR creation, the
-- other half explicitly named there, now that Wave 3 has begun.
--
-- The MAR *domain* audit trail was already atomic: enforce_and_audit_mar_state()
-- (migration 202607270003) inserts a MAR.Created mar_audit_events row as
-- part of the same insert via a BEFORE INSERT trigger, and
-- mar_audit_events_idempotency_idx already gives that a unique
-- (organization_id, idempotency_key) constraint. What was missing is the
-- *platform* runtime evidence (governance_audit_events/
-- runtime_outbox_events, via record_runtime_evidence) every other atomic
-- use case this session already commits in the same transaction as its
-- business state.

create or replace function public.create_mar(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_patient_id uuid,
  target_prescription_id uuid,
  target_requested_medicine_id uuid,
  target_patient_notes text
)
returns public.medication_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_event public.mar_audit_events;
  existing_mar public.medication_access_requests;
  created public.medication_access_requests;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Tenant membership is invalid';
  end if;

  -- Mirrors the medication_access_requests_create RLS policy exactly:
  -- this function is SECURITY DEFINER and therefore bypasses RLS, so it
  -- must re-enforce the same authorization the policy would (a patient
  -- creating their own request, or clinical/pharmacy staff creating one on
  -- a patient's behalf).
  if target_patient_id is distinct from target_actor_id
     and not public.has_organization_role(
       target_organization_id,
       array['pharmacist', 'pharmacy_staff']::public.member_role[]
     )
  then
    raise exception 'Actor may not create a medication access request for this patient';
  end if;

  -- Idempotent replay: medication_access_requests.transition_idempotency_key
  -- is overwritten on every later state transition, so it can't be used to
  -- detect a repeated *creation* call -- mar_audit_events_idempotency_idx's
  -- unique (organization_id, idempotency_key) constraint on the MAR.Created
  -- event is the only stable key for that.
  select * into existing_event from public.mar_audit_events
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key
    and event_type = 'MAR.Created';
  if found then
    select * into existing_mar from public.medication_access_requests
    where id = existing_event.mar_id and organization_id = target_organization_id;
    return existing_mar;
  end if;

  insert into public.medication_access_requests (
    organization_id, patient_id, prescription_id, requested_medicine_id,
    patient_notes, transition_idempotency_key, created_by
  ) values (
    target_organization_id, target_patient_id, target_prescription_id,
    target_requested_medicine_id, target_patient_notes, target_idempotency_key,
    target_actor_id
  )
  returning * into created;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'mar.create',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'medication_access_request', created.id::text, null,
    jsonb_build_object('state', created.state),
    null, null, target_channel, 'mar.created',
    jsonb_build_object('marId', created.id)
  );

  return created;
end;
$$;

revoke all on function public.create_mar(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, text
) from public;
grant execute on function public.create_mar(
  uuid, uuid, text, text, text, text, uuid, uuid, uuid, text
) to authenticated;

comment on function public.create_mar is
  'Atomic Wave 3 use case: commits a new medication access request and its runtime evidence in one transaction. The MAR.Created domain audit event is already atomic via enforce_and_audit_mar_state() (migration 202607270003); this adds the platform evidence commit that trigger does not.';
