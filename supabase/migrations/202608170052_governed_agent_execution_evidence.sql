-- Durable evidence authority for the existing AgentTaskExecutor. Domain
-- mutation remains in canonical RPCs; this function records only execution
-- lifecycle and policy metadata.
alter table public.ai_runs drop constraint ai_runs_agent_name_check;
alter table public.ai_runs add constraint ai_runs_agent_name_check check (
  agent_name in (
    'prescription_reader', 'medicine_matcher', 'inventory_finder',
    'clinical_review_assistant', 'pricing_advisor',
    'reservation_coordinator', 'medication_education_assistant',
    'population_health_analyst', 'conversation_agent', 'ocr_agent',
    'medicine_match_agent', 'inventory_agent'
  )
);

create or replace function public.record_governed_agent_task_event(
  target_organization_id uuid,
  target_actor_id uuid,
  target_agent_id text,
  target_agent_version text,
  target_capability text,
  target_persona text,
  target_workflow_id text,
  target_conversation_id text,
  target_correlation_id text,
  target_task_id text,
  target_status text,
  target_duration_ms integer,
  target_requires_human_approval boolean,
  target_error_code text default null,
  target_prescription_id uuid default null,
  target_mar_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid;
  stored_agent_name text;
  stored_status public.ai_run_status;
  stored_prescription_id uuid := target_prescription_id;
  stored_workflow_id text := nullif(btrim(target_workflow_id), '');
begin
  if target_agent_id is null
     or target_agent_id not in (
       'conversation', 'ocr', 'medicine-match', 'inventory',
       'clinical-review-assistant', 'reservation-coordinator',
       'prescription-reader'
     )
     or target_status is null
     or target_status not in (
       'started', 'completed', 'failed', 'policy_denied',
       'pending_human_review'
     )
     or nullif(btrim(target_task_id), '') is null
     or nullif(btrim(target_agent_version), '') is null
     or nullif(btrim(target_capability), '') is null
     or nullif(btrim(target_persona), '') is null
     or nullif(btrim(target_correlation_id), '') is null
     or target_duration_ms is null
     or target_duration_ms < 0
     or (
       auth.role() <> 'service_role'
       and (
         auth.uid() is null
         or target_actor_id is distinct from auth.uid()
         or not public.is_organization_member(target_organization_id)
       )
     )
  then
    raise exception 'invalid governed agent evidence context' using errcode = '42501';
  end if;

  if target_actor_id is not null and not exists (
    select 1 from auth.users where id = target_actor_id
  ) then
    raise exception 'invalid governed agent actor' using errcode = '42501';
  end if;

  if target_mar_id is not null then
    select mar.prescription_id into stored_prescription_id
    from public.medication_access_requests mar
    where mar.id = target_mar_id
      and mar.organization_id = target_organization_id;
    if not found then
      raise exception 'invalid governed agent MAR context' using errcode = '42501';
    end if;
    if target_prescription_id is not null
       and target_prescription_id is distinct from stored_prescription_id then
      raise exception 'governed agent prescription context mismatch' using errcode = '42501';
    end if;
  elsif stored_prescription_id is not null and not exists (
    select 1 from public.prescriptions prescription
    where prescription.id = stored_prescription_id
      and prescription.organization_id = target_organization_id
  ) then
    raise exception 'invalid governed agent prescription context' using errcode = '42501';
  end if;

  if stored_workflow_id is null and stored_prescription_id is not null then
    select validation.workflow_run_id::text into stored_workflow_id
    from public.clinical_validations validation
    where validation.organization_id = target_organization_id
      and validation.prescription_id = stored_prescription_id
      and validation.workflow_run_id is not null
    order by validation.created_at desc
    limit 1;
  end if;

  stored_agent_name := case target_agent_id
    when 'conversation' then 'conversation_agent'
    when 'ocr' then 'ocr_agent'
    when 'medicine-match' then 'medicine_match_agent'
    when 'inventory' then 'inventory_agent'
    when 'clinical-review-assistant' then 'clinical_review_assistant'
    when 'reservation-coordinator' then 'reservation_coordinator'
    else 'prescription_reader'
  end;
  stored_status := case
    when target_status = 'completed' then 'completed'::public.ai_run_status
    when target_status in ('failed', 'policy_denied') then 'failed'::public.ai_run_status
    when target_status = 'pending_human_review' then 'queued'::public.ai_run_status
    else 'running'::public.ai_run_status
  end;

  insert into public.ai_runs(
    organization_id, mar_id, prescription_id, agent_name, status,
    provider, model, prompt_version, input_reference, output,
    idempotency_key, correlation_id, error_code, started_at, completed_at,
    created_by
  ) values (
    target_organization_id, target_mar_id, stored_prescription_id,
    stored_agent_name, stored_status, 'medlink-agent-runtime', target_agent_id,
    target_agent_version,
    jsonb_build_object(
      'taskId', target_task_id,
      'agentId', target_agent_id,
      'capability', target_capability,
      'persona', target_persona,
      'workflowId', stored_workflow_id,
      'conversationId', target_conversation_id,
      'requiresHumanApproval', target_requires_human_approval
    ),
    case when target_status = 'completed'
      then jsonb_build_object('outcome', 'completed', 'durationMs', target_duration_ms)
      else null end,
    'agent-task:' || target_task_id, target_correlation_id,
    target_error_code,
    case when target_status = 'started' then now() else null end,
    case when target_status in ('completed', 'failed', 'policy_denied') then now() else null end,
    target_actor_id
  )
  on conflict (organization_id, idempotency_key) do update set
    status = excluded.status,
    input_reference = public.ai_runs.input_reference || excluded.input_reference,
    output = coalesce(excluded.output, public.ai_runs.output),
    error_code = excluded.error_code,
    started_at = coalesce(public.ai_runs.started_at, excluded.started_at, now()),
    completed_at = excluded.completed_at,
    updated_at = now()
  returning id into run_id;

  insert into public.ai_audit_events(
    organization_id, ai_run_id, event_type, actor_id, idempotency_key, metadata
  ) values (
    target_organization_id, run_id, 'AgentTask.' || target_status,
    target_actor_id, 'agent-task:' || target_task_id || ':' || target_status,
    jsonb_build_object(
      'agentId', target_agent_id,
      'agentVersion', target_agent_version,
      'capability', target_capability,
      'persona', target_persona,
      'workflowId', stored_workflow_id,
      'conversationId', target_conversation_id,
      'correlationId', target_correlation_id,
      'policyResult', target_status,
      'requiresHumanApproval', target_requires_human_approval,
      'durationMs', target_duration_ms,
      'errorCode', target_error_code
    )
  ) on conflict (organization_id, idempotency_key) do nothing;

  return run_id;
end;
$$;

revoke all on function public.record_governed_agent_task_event(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  integer, boolean, text, uuid, uuid
) from public;
grant execute on function public.record_governed_agent_task_event(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  integer, boolean, text, uuid, uuid
) to authenticated, service_role;

grant select on public.ai_runs, public.ai_audit_events to service_role;
