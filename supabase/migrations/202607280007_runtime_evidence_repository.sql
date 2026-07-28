-- S01.9 Batch 7: immutable, tenant-scoped runtime evidence repository.

create table public.runtime_evidence_records (
  id uuid primary key,
  evidence_type text not null check (btrim(evidence_type) <> ''),
  category text not null check (
    category in ('runtime', 'observability', 'certification', 'security', 'quality')
  ),
  source_component text not null check (btrim(source_component) <> ''),
  correlation_id text,
  trace_id text,
  request_id text,
  tenant_id uuid references public.organizations(id),
  organization_id uuid references public.organizations(id),
  runtime_version text not null,
  platform_version text not null,
  certification_profile text,
  evidence_timestamp timestamptz not null,
  integrity_hash text not null check (integrity_hash ~ '^[A-Fa-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  retention_class text not null check (
    retention_class in ('temporary', 'operational', 'audit', 'compliance', 'permanent')
  ),
  evidence_version integer not null check (evidence_version > 0),
  parent_version_id uuid references public.runtime_evidence_records(id),
  created_at timestamptz not null default now(),
  check (tenant_id is not distinct from organization_id),
  check (
    metadata::text !~* '"(password|secret|token|api_key|private_key|credential|patient)"[[:space:]]*:'
  )
);

create index runtime_evidence_query_idx
  on public.runtime_evidence_records(category, evidence_timestamp desc);
create index runtime_evidence_correlation_idx
  on public.runtime_evidence_records(organization_id, correlation_id);
create index runtime_evidence_profile_idx
  on public.runtime_evidence_records(certification_profile, evidence_timestamp desc);

create trigger runtime_evidence_append_only
before update or delete on public.runtime_evidence_records
for each row execute function public.prevent_enterprise_event_mutation();

alter table public.runtime_evidence_records enable row level security;

create policy runtime_evidence_admin_read
  on public.runtime_evidence_records for select to authenticated
  using (
    organization_id is null
    or public.has_organization_role(
      organization_id, array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

create policy runtime_evidence_admin_insert
  on public.runtime_evidence_records for insert to authenticated
  with check (
    organization_id is null
    or public.has_organization_role(
      organization_id, array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

comment on table public.runtime_evidence_records is
  'Immutable, versioned, integrity-hashed operational and certification evidence.';
