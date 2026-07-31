-- S01.9: durable operational telemetry and machine-readable certification.

create table public.runtime_metric_points (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  name text not null check (name ~ '^[a-z][a-z0-9_]*$'),
  kind text not null check (kind in ('counter', 'gauge', 'histogram')),
  value double precision not null,
  labels jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  service text not null,
  component text not null,
  operation text not null,
  environment text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    labels::text !~* '"(patient|prescription|password|secret|token|credential)"[[:space:]]*:'
  )
);

create index runtime_metric_points_query_idx
  on public.runtime_metric_points(organization_id, name, observed_at desc);

create table public.runtime_trace_spans (
  trace_id text not null check (trace_id ~ '^[A-Fa-f0-9]{32}$'),
  span_id text not null check (span_id ~ '^[A-Fa-f0-9]{16}$'),
  organization_id uuid not null references public.organizations(id),
  tenant_id uuid not null references public.organizations(id),
  parent_span_id text,
  parent_trace_id text,
  correlation_id text not null,
  request_id text not null,
  workflow_id text,
  conversation_id text,
  service text not null,
  component text not null,
  operation text not null,
  status text not null check (status in ('active', 'succeeded', 'failed')),
  error_code text,
  error_category text,
  retryable boolean,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms double precision,
  created_at timestamptz not null default now(),
  primary key (trace_id, span_id),
  check (tenant_id = organization_id)
);

create index runtime_trace_spans_correlation_idx
  on public.runtime_trace_spans(organization_id, correlation_id, started_at desc);
create index runtime_trace_spans_trace_idx
  on public.runtime_trace_spans(trace_id, started_at);

create table public.runtime_diagnostic_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  tenant_id uuid not null references public.organizations(id),
  correlation_id text not null,
  trace_id text not null,
  request_id text not null,
  service text not null,
  component text not null,
  operation text not null,
  category text not null,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  confidence double precision not null check (confidence between 0 and 1),
  first_detected timestamptz not null,
  last_detected timestamptz not null,
  occurrence_count integer not null check (occurrence_count > 0),
  resolution_status text not null check (resolution_status in ('open', 'resolved')),
  root_cause text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (tenant_id = organization_id)
);

create index runtime_diagnostic_events_open_idx
  on public.runtime_diagnostic_events(
    organization_id, severity, last_detected desc
  ) where resolution_status = 'open';

create table public.runtime_certification_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  profile text not null,
  score double precision not null check (score between 0 and 100),
  status text not null,
  platform_version text not null,
  runtime_version text not null,
  report jsonb not null,
  integrity_hash text not null check (integrity_hash ~ '^[A-Fa-f0-9]{64}$'),
  executed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    report::text !~* '"(password|secret|token|credential|patient)"[[:space:]]*:'
  )
);

create index runtime_certification_reports_latest_idx
  on public.runtime_certification_reports(
    organization_id, profile, executed_at desc
  );

create trigger runtime_metric_points_append_only
before update or delete on public.runtime_metric_points
for each row execute function public.prevent_enterprise_event_mutation();
create trigger runtime_trace_spans_append_only
before update or delete on public.runtime_trace_spans
for each row execute function public.prevent_enterprise_event_mutation();
create trigger runtime_certification_reports_append_only
before update or delete on public.runtime_certification_reports
for each row execute function public.prevent_enterprise_event_mutation();

alter table public.runtime_metric_points enable row level security;
alter table public.runtime_trace_spans enable row level security;
alter table public.runtime_diagnostic_events enable row level security;
alter table public.runtime_certification_reports enable row level security;

create policy runtime_metrics_admin_read
  on public.runtime_metric_points for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
create policy runtime_metrics_member_insert
  on public.runtime_metric_points for insert to authenticated
  with check (public.is_organization_member(organization_id));

create policy runtime_traces_admin_read
  on public.runtime_trace_spans for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
create policy runtime_traces_member_insert
  on public.runtime_trace_spans for insert to authenticated
  with check (public.is_organization_member(organization_id));

create policy runtime_diagnostics_admin_all
  on public.runtime_diagnostic_events for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));

create policy runtime_diagnostics_member_insert
  on public.runtime_diagnostic_events for insert to authenticated
  with check (public.is_organization_member(organization_id));

create policy runtime_certification_admin_read
  on public.runtime_certification_reports for select to authenticated
  using (
    organization_id is null
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );
create policy runtime_certification_admin_insert
  on public.runtime_certification_reports for insert to authenticated
  with check (
    organization_id is null
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );
