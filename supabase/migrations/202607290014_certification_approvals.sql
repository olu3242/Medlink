create table public.certification_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  discipline text not null check (
    discipline in ('clinical', 'privacy', 'security', 'operations')
  ),
  approver_id uuid not null references auth.users(id),
  key_id text not null,
  algorithm text not null check (algorithm = 'ed25519'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approved', 'rejected')),
  signature bytea not null check (octet_length(signature) > 0),
  signed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, discipline, evidence_sha256, approver_id),
  check (expires_at > signed_at)
);

create index certification_approvals_evidence_idx
  on public.certification_approvals(organization_id, evidence_sha256, discipline);

alter table public.certification_approvals enable row level security;

create policy certification_approvals_admin_read
  on public.certification_approvals for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

create trigger certification_approvals_append_only
  before update or delete on public.certification_approvals
  for each row execute function public.prevent_enterprise_event_mutation();
