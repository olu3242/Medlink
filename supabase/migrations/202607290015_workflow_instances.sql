-- Wave 3, Batch 3.2: durable Workflow Orchestrator persistence.
--
-- Backs packages/workflows' WorkflowStore port
-- (findByKey/create/markStep/complete) with a real table, closing the
-- "durable" half of RC1_BACKLOG item 16 -- the package itself only ever
-- had an in-memory test fake behind it until this migration.
--
-- idempotency_key is unique per organization, the same pattern
-- reservations/runtime_outbox_events already use: a repeated call with the
-- same key returns the existing instance (WorkflowService.run() checks
-- findByKey before create) rather than starting a second, divergent run of
-- the same logical workflow.

create table public.workflow_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  type text not null check (char_length(type) between 1 and 100),
  status public.workflow_run_status not null default 'running',
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  completed_steps text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index workflow_instances_type_idx
  on public.workflow_instances(organization_id, type, status);

create trigger workflow_instances_set_updated_at
before update on public.workflow_instances
for each row execute function public.set_updated_at();

alter table public.workflow_instances enable row level security;

-- Mirrors conversations_read/conversations_admin_manage (migration
-- 202607290012): the caller identity that drives a workflow run isn't
-- settled yet (see docs/adr/0004-conversation-runtime-webhook-identity.md
-- -- the same open question applies here, since a Conversation-triggered
-- workflow has the same unauthenticated-origin problem a WhatsApp webhook
-- does), so this scopes to platform/tenant admin visibility for now rather
-- than guessing a patient-facing policy ahead of that decision.
create policy workflow_instances_read
  on public.workflow_instances for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );
create policy workflow_instances_admin_manage
  on public.workflow_instances for all to authenticated
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
  );

comment on table public.workflow_instances is
  'Durable state for packages/workflows'' WorkflowService: one row per (organization_id, idempotency_key) workflow run, tracking completed steps and accumulated context.';
