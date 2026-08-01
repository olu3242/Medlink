-- AGL-2: Agent Context & Memory Governance.
--
-- Backs packages/agents' AgentMemoryStore: tenant-scoped, RLS-protected
-- working memory for a governed agent (packages/agents/src/registry.ts's
-- governedAgentCatalog), bounded per agent by memory_boundary ('session' |
-- 'tenant-durable'; an agent whose registry entry declares memoryBoundary
-- 'none' never reaches this table at all -- packages/agents/src/memory.ts's
-- authorizeMemoryWrite rejects the write before any row is attempted).
-- Whether an agent is allowed to write, and under which boundary, is a
-- TS-layer decision -- this migration adds an independent database-level
-- safety net (a session row must always carry an expiry regardless of what
-- the calling code intended), the same defense-in-depth relationship
-- packages/agents/src/policy.ts already documents between its own
-- authorization decision and each canonical RPC's RBAC re-enforcement.
--
-- Like conversation_messages/conversation_events (migration 202607290012),
-- there is no `authenticated` write policy: an agent acts through the
-- service role, never as a request-scoped authenticated end-user session.
-- Authenticated platform/tenant admins get read-only access for support
-- and audit.

create table public.agent_memory_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  agent_id text not null check (char_length(agent_id) between 1 and 64),
  memory_boundary text not null check (memory_boundary in ('session', 'tenant-durable')),
  -- The entity the memory is about (a patient/user id) or, for agent-level
  -- rather than subject-level memory (e.g. the Analytics agent's tenant
  -- aggregates), the organization's own id. Required rather than nullable
  -- so the uniqueness constraint below behaves predictably -- Postgres
  -- treats every NULL as distinct, which would silently defeat it.
  subject_id uuid not null,
  key text not null check (char_length(key) between 1 and 128),
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint agent_memory_entries_session_requires_expiry
    check (memory_boundary <> 'session' or expires_at is not null),
  unique (organization_id, agent_id, subject_id, key)
);

create index agent_memory_entries_org_agent_idx
  on public.agent_memory_entries(organization_id, agent_id);
create index agent_memory_entries_expiry_idx
  on public.agent_memory_entries(expires_at)
  where expires_at is not null;

create trigger agent_memory_entries_set_updated_at
before update on public.agent_memory_entries
for each row execute function public.set_updated_at();

alter table public.agent_memory_entries enable row level security;

create policy agent_memory_entries_admin_read
  on public.agent_memory_entries for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

comment on table public.agent_memory_entries is
  'Tenant-scoped working memory for a governed agent (packages/agents), bounded by memory_boundary and, for session memory, a mandatory expiry. Written through the service role only -- agents act through governed infrastructure, never as a request-scoped authenticated session.';
