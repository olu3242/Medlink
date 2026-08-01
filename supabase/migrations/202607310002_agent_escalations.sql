-- AGL-5: Human-AI Supervision, Escalation & Control.
--
-- Backs packages/agents' EscalationStore: a durable, tenant-scoped,
-- RLS-protected record of every agent plan step AGL-1's registry marks
-- requiresHumanApproval. AGL-3's toWorkflowSteps halts such a step
-- immediately with a one-shot exception; this migration is what lets
-- toSupervisedWorkflowSteps (AGL-5) instead raise a resumable record and
-- block until a human actually decides it -- mirroring
-- decide_clinical_review's (migration 202607290017) atomic,
-- idempotent-replay-safe decision pattern, generalized from "clinical
-- review" to "any governed agent capability a human must approve".
--
-- Deciding is restricted to 'pharmacist' for RC1, matching
-- decide_clinical_review exactly: every requiresHumanApproval capability in
-- the current governed catalog (packages/agents/src/registry.ts) is
-- clinical (Clinical Review Assistant's flag_validation_findings). A future
-- non-clinical human-approval capability would need this role list
-- broadened deliberately, not silently -- see the same "frozen platform
-- change needs an ADR, not a quiet merge" posture RC1_BACKLOG.md already
-- applies elsewhere.

create type public.agent_escalation_status as enum ('pending', 'approved', 'rejected');

create table public.agent_escalations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  capability_name text not null check (char_length(capability_name) between 1 and 128),
  workflow_type text not null check (char_length(workflow_type) between 1 and 64),
  subject_id uuid not null,
  status public.agent_escalation_status not null default 'pending',
  requested_payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index agent_escalations_org_status_idx
  on public.agent_escalations(organization_id, status);

create trigger agent_escalations_set_updated_at
before update on public.agent_escalations
for each row execute function public.set_updated_at();

alter table public.agent_escalations enable row level security;

create policy agent_escalations_read
  on public.agent_escalations for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['pharmacist', 'platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

comment on table public.agent_escalations is
  'Durable record of a governed agent plan step (packages/agents) awaiting or having received a human decision. A pending row blocks the plan; deciding it is the only path past that block.';

-- Atomic, idempotent creation: the same (organization, idempotency_key)
-- raised twice (e.g. a retried plan re-evaluating the same halted step)
-- returns the existing escalation rather than raising a duplicate.
create or replace function public.raise_agent_escalation(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_agent_id text,
  target_capability_name text,
  target_workflow_type text,
  target_subject_id uuid,
  target_payload jsonb
)
returns public.agent_escalations
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.agent_escalations;
  created public.agent_escalations;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Tenant membership is invalid';
  end if;

  select * into existing from public.agent_escalations
  where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  if found then
    return existing;
  end if;

  insert into public.agent_escalations (
    organization_id, agent_id, capability_name, workflow_type, subject_id,
    requested_payload, idempotency_key
  ) values (
    target_organization_id, target_agent_id, target_capability_name, target_workflow_type,
    target_subject_id, coalesce(target_payload, '{}'::jsonb), target_idempotency_key
  )
  returning * into created;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'agents.escalations.raise',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'agent_escalation', created.id::text, null,
    jsonb_build_object('agentId', created.agent_id, 'capabilityName', created.capability_name),
    null, null, target_channel, 'agent_escalation.raised',
    jsonb_build_object('escalationId', created.id, 'agentId', created.agent_id)
  );

  return created;
end;
$$;

revoke all on function public.raise_agent_escalation(
  uuid, uuid, text, text, text, text, text, text, text, uuid, jsonb
) from public;
grant execute on function public.raise_agent_escalation(
  uuid, uuid, text, text, text, text, text, text, text, uuid, jsonb
) to authenticated;

comment on function public.raise_agent_escalation is
  'Atomic AGL-5 use case: records a governed agent plan step awaiting human approval and commits its runtime evidence in one transaction. Idempotent on (organization_id, idempotency_key).';

-- Mirrors decide_clinical_review exactly: a repeated call with the same
-- actor, status, and rationale on an already-decided escalation replays
-- safely; anything else targeting an already-decided escalation is a real
-- conflict and still raises.
create or replace function public.decide_agent_escalation(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_escalation_id uuid,
  target_status public.agent_escalation_status,
  target_rationale text
)
returns public.agent_escalations
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.agent_escalations;
  updated public.agent_escalations;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id, array['pharmacist']::public.member_role[]
  ) then
    raise exception 'Only a licensed pharmacist may decide an agent escalation';
  end if;
  if target_status = 'pending' then
    raise exception 'A decision must be approved or rejected';
  end if;

  select * into existing from public.agent_escalations
  where id = target_escalation_id and organization_id = target_organization_id;
  if not found then
    raise exception 'Agent escalation not found';
  end if;

  if existing.status <> 'pending' then
    if existing.status = target_status
       and existing.decided_by = target_actor_id
       and existing.decision_rationale is not distinct from target_rationale then
      return existing;
    end if;
    raise exception 'Agent escalation has already been decided';
  end if;

  update public.agent_escalations
  set status = target_status,
      decided_by = target_actor_id,
      decided_at = now(),
      decision_rationale = target_rationale,
      updated_at = now()
  where id = target_escalation_id and organization_id = target_organization_id
  returning * into updated;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'agents.escalations.decide',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'agent_escalation', updated.id::text, null,
    jsonb_build_object('status', updated.status),
    null, null, target_channel, 'agent_escalation.decided',
    jsonb_build_object('escalationId', updated.id, 'status', updated.status)
  );

  return updated;
end;
$$;

revoke all on function public.decide_agent_escalation(
  uuid, uuid, text, text, text, text, uuid, public.agent_escalation_status, text
) from public;
grant execute on function public.decide_agent_escalation(
  uuid, uuid, text, text, text, text, uuid, public.agent_escalation_status, text
) to authenticated;

comment on function public.decide_agent_escalation is
  'Atomic AGL-5 use case: commits a pharmacist''s decision on an agent escalation and its runtime evidence in one transaction. Idempotent replay is keyed on the decision itself, matching decide_clinical_review.';
