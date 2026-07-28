-- Wave 5: Enterprise Governance, Integrations, Reporting, and Security
-- Static invariants:
--   * Governance/security histories remain append-only even when RLS is bypassed.
--   * Secrets are represented only by one-way hashes or external vault references.
--   * Webhook bodies are encrypted before persistence.
--   * Every tenant relationship is protected by organization-scoped foreign keys.

create type public.consent_action as enum ('granted', 'revoked');
create type public.incident_status as enum (
  'open', 'investigating', 'contained', 'resolved', 'closed'
);
create type public.incident_severity as enum (
  'low', 'medium', 'high', 'critical'
);
create type public.integration_kind as enum (
  'fhir', 'hl7', 'hmo', 'government', 'manufacturer', 'distributor',
  'custom'
);
create type public.endpoint_status as enum ('active', 'paused', 'disabled');
create type public.webhook_direction as enum ('inbound', 'outbound');
create type public.delivery_state as enum (
  'queued', 'processing', 'succeeded', 'retrying', 'failed', 'dead_letter'
);
create type public.reporting_job_status as enum (
  'queued', 'running', 'completed', 'failed', 'cancelled', 'expired'
);
create type public.workflow_run_status as enum (
  'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'
);
create type public.api_client_status as enum ('active', 'suspended', 'revoked');

create table public.governance_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  event_type text not null check (char_length(event_type) between 3 and 160),
  actor_id uuid references auth.users(id),
  actor_type text not null check (actor_type in ('user', 'api_client', 'system')),
  actor_reference text,
  resource_type text not null,
  resource_id text,
  action text not null,
  outcome text not null check (outcome in ('success', 'denied', 'failure')),
  purpose text,
  reason text,
  correlation_id text,
  request_id text,
  source_ip_hash text,
  user_agent_hash text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (
    source_ip_hash is null or source_ip_hash ~ '^[A-Fa-f0-9]{64}$'
  ),
  check (
    user_agent_hash is null or user_agent_hash ~ '^[A-Fa-f0-9]{64}$'
  ),
  check (
    metadata::text !~* '"(password|secret|token|api_key|private_key|credential|card_number|cvv|cvc)"[[:space:]]*:'
  )
);

create index governance_audit_events_timeline_idx
  on public.governance_audit_events(organization_id, occurred_at desc, id);
create index governance_audit_events_resource_idx
  on public.governance_audit_events(organization_id, resource_type, resource_id, occurred_at);
create index governance_audit_events_actor_idx
  on public.governance_audit_events(actor_id, occurred_at desc)
  where actor_id is not null;
create index governance_audit_events_correlation_idx
  on public.governance_audit_events(correlation_id)
  where correlation_id is not null;

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  subject_user_id uuid not null references auth.users(id),
  consent_type text not null check (char_length(consent_type) between 2 and 120),
  policy_version text not null,
  action public.consent_action not null,
  lawful_basis text,
  scope jsonb not null default '{}'::jsonb,
  supersedes_id uuid,
  captured_by uuid references auth.users(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  evidence_hash text not null,
  occurred_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
  check (action = 'granted' or supersedes_id is not null),
  foreign key (supersedes_id, organization_id)
    references public.consent_records(id, organization_id) on delete restrict
);

create unique index consent_records_single_successor_idx
  on public.consent_records(supersedes_id)
  where supersedes_id is not null;
create index consent_records_subject_timeline_idx
  on public.consent_records(subject_user_id, consent_type, occurred_at desc);
create index consent_records_org_type_idx
  on public.consent_records(organization_id, consent_type, occurred_at desc);

create table public.governance_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  title text not null check (char_length(title) between 3 and 240),
  description text not null,
  severity public.incident_severity not null,
  status public.incident_status not null default 'open',
  assigned_to uuid references auth.users(id),
  detected_at timestamptz not null,
  contained_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (contained_at is null or contained_at >= detected_at),
  check (resolved_at is null or resolved_at >= detected_at),
  check (closed_at is null or closed_at >= detected_at)
);

create index governance_incidents_queue_idx
  on public.governance_incidents(organization_id, status, severity, detected_at);

create table public.governance_incident_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  incident_id uuid not null,
  event_type text not null,
  actor_id uuid references auth.users(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (incident_id, organization_id)
    references public.governance_incidents(id, organization_id) on delete restrict
);

create index governance_incident_events_timeline_idx
  on public.governance_incident_events(incident_id, occurred_at, id);

create table public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  resource_type text not null,
  retention_days integer not null check (retention_days > 0),
  legal_hold_enabled boolean not null default false,
  disposition_action text not null check (
    disposition_action in ('delete', 'anonymize', 'archive')
  ),
  policy_version integer not null default 1 check (policy_version > 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, resource_type, policy_version)
);

create index retention_policies_active_idx
  on public.retention_policies(organization_id, resource_type)
  where is_active;

create table public.retention_executions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  retention_policy_id uuid not null,
  resource_reference_hash text not null,
  action text not null check (action in ('deleted', 'anonymized', 'archived', 'skipped_legal_hold')),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  executed_by text not null,
  evidence_reference text,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (resource_reference_hash ~ '^[A-Fa-f0-9]{64}$'),
  foreign key (retention_policy_id, organization_id)
    references public.retention_policies(id, organization_id) on delete restrict
);

create index retention_executions_policy_idx
  on public.retention_executions(retention_policy_id, occurred_at desc);

create table public.integration_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (char_length(name) between 2 and 160),
  kind public.integration_kind not null,
  status public.endpoint_status not null default 'active',
  base_url text not null check (base_url ~ '^https://'),
  configuration jsonb not null default '{}'::jsonb,
  credential_reference text,
  signing_secret_reference text,
  timeout_ms integer not null default 10000 check (timeout_ms between 100 and 120000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, name),
  check (
    configuration::text !~* '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  ),
  check (
    credential_reference is null
    or credential_reference ~ '^(vault|secret|kms)://'
  ),
  check (
    signing_secret_reference is null
    or signing_secret_reference ~ '^(vault|secret|kms)://'
  )
);

create index integration_endpoints_active_idx
  on public.integration_endpoints(organization_id, kind)
  where deleted_at is null and status = 'active';

create table public.integration_webhook_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  endpoint_id uuid not null,
  direction public.webhook_direction not null,
  event_type text not null,
  external_event_reference text,
  payload_ciphertext text not null,
  encryption_key_reference text not null check (
    encryption_key_reference ~ '^(vault|secret|kms)://'
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  status public.delivery_state not null default 'queued',
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  correlation_id text,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (
    payload_ciphertext ~ '^enc:v[0-9]+:'
    and char_length(payload_ciphertext) > 32
  ),
  foreign key (endpoint_id, organization_id)
    references public.integration_endpoints(id, organization_id) on delete restrict
);

create unique index integration_webhook_external_event_idx
  on public.integration_webhook_messages(endpoint_id, external_event_reference)
  where external_event_reference is not null;
create index integration_webhook_queue_idx
  on public.integration_webhook_messages(status, available_at, id)
  where status in ('queued', 'retrying');

create table public.integration_delivery_attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  webhook_message_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status public.delivery_state not null,
  http_status integer check (http_status between 100 and 599),
  response_hash text,
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  attempted_at timestamptz not null default now(),
  unique (webhook_message_id, attempt_number),
  check (response_hash is null or response_hash ~ '^[A-Fa-f0-9]{64}$'),
  foreign key (webhook_message_id, organization_id)
    references public.integration_webhook_messages(id, organization_id) on delete restrict
);

create index integration_delivery_attempts_timeline_idx
  on public.integration_delivery_attempts(webhook_message_id, attempted_at, id);

create table public.reporting_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  report_type text not null,
  parameters jsonb not null default '{}'::jsonb,
  status public.reporting_job_status not null default 'queued',
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  requested_by uuid not null references auth.users(id),
  correlation_id text,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (
    parameters::text !~* '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  )
);

create index reporting_jobs_queue_idx
  on public.reporting_jobs(status, created_at)
  where status = 'queued';
create index reporting_jobs_requester_idx
  on public.reporting_jobs(requested_by, created_at desc);

create table public.reporting_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  reporting_job_id uuid not null,
  storage_bucket text not null,
  storage_object_path text not null,
  content_type text not null,
  sha256 text not null check (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  row_count bigint check (row_count is null or row_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (reporting_job_id),
  foreign key (reporting_job_id, organization_id)
    references public.reporting_jobs(id, organization_id) on delete restrict,
  check (expires_at > created_at)
);

create index reporting_exports_expiry_idx
  on public.reporting_exports(expires_at);

create table public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (char_length(name) between 2 and 160),
  version integer not null check (version > 0),
  definition jsonb not null,
  definition_sha256 text not null check (definition_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  is_active boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name, version),
  check (
    definition::text !~* '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  )
);

create unique index workflow_definitions_one_active_idx
  on public.workflow_definitions(organization_id, name)
  where is_active;

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  workflow_definition_id uuid not null,
  status public.workflow_run_status not null default 'queued',
  subject_type text,
  subject_reference text,
  input_reference jsonb not null default '{}'::jsonb,
  output_reference jsonb,
  current_step text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  correlation_id text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (workflow_definition_id, organization_id)
    references public.workflow_definitions(id, organization_id) on delete restrict,
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check (
    input_reference::text !~* '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  ),
  check (
    output_reference is null
    or output_reference::text !~* '"(password|secret|token|api_key|private_key|credential)"[[:space:]]*:'
  )
);

create index workflow_runs_queue_idx
  on public.workflow_runs(status, created_at)
  where status in ('queued', 'running', 'waiting');
create index workflow_runs_subject_idx
  on public.workflow_runs(organization_id, subject_type, subject_reference, created_at desc);
create index workflow_runs_correlation_idx
  on public.workflow_runs(correlation_id);

create table public.workflow_run_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  workflow_run_id uuid not null,
  event_type text not null,
  step_name text,
  actor_id uuid references auth.users(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (workflow_run_id, organization_id)
    references public.workflow_runs(id, organization_id) on delete restrict
);

create index workflow_run_events_timeline_idx
  on public.workflow_run_events(workflow_run_id, occurred_at, id);

create table public.security_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  event_type text not null check (char_length(event_type) between 3 and 160),
  severity public.incident_severity not null,
  actor_id uuid references auth.users(id),
  api_client_id uuid,
  source_ip_hash text,
  user_agent_hash text,
  resource_type text,
  resource_reference_hash text,
  outcome text not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (
    source_ip_hash is null or source_ip_hash ~ '^[A-Fa-f0-9]{64}$'
  ),
  check (
    user_agent_hash is null or user_agent_hash ~ '^[A-Fa-f0-9]{64}$'
  ),
  check (
    resource_reference_hash is null
    or resource_reference_hash ~ '^[A-Fa-f0-9]{64}$'
  ),
  check (
    metadata::text !~* '"(password|secret|token|api_key|private_key|credential|card_number|cvv|cvc)"[[:space:]]*:'
  )
);

create index security_events_org_timeline_idx
  on public.security_events(organization_id, severity, occurred_at desc);
create index security_events_actor_idx
  on public.security_events(actor_id, occurred_at desc)
  where actor_id is not null;
create index security_events_correlation_idx
  on public.security_events(correlation_id)
  where correlation_id is not null;

create table public.api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (char_length(name) between 2 and 160),
  client_identifier text not null,
  status public.api_client_status not null default 'active',
  allowed_scopes text[] not null default '{}'::text[],
  allowed_cidrs cidr[] not null default '{}'::cidr[],
  last_used_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organization_id),
  unique (client_identifier),
  unique (organization_id, name)
);

alter table public.security_events
  add constraint security_events_api_client_fk
  foreign key (api_client_id, organization_id)
  references public.api_clients(id, organization_id);

create table public.api_client_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  api_client_id uuid not null,
  secret_hash text not null,
  secret_fingerprint text not null check (
    secret_fingerprint ~ '^[A-Fa-f0-9]{64}$'
  ),
  hash_algorithm text not null check (hash_algorithm in ('argon2id', 'scrypt')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (secret_fingerprint),
  foreign key (api_client_id, organization_id)
    references public.api_clients(id, organization_id) on delete restrict,
  check (
    secret_hash like '$argon2id$%' or secret_hash like '$scrypt$%'
  ),
  check (expires_at is null or expires_at > created_at)
);

create index api_client_credentials_active_idx
  on public.api_client_credentials(api_client_id, expires_at)
  where revoked_at is null;

create or replace function public.prevent_enterprise_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger governance_audit_events_append_only
before update or delete on public.governance_audit_events
for each row execute function public.prevent_enterprise_event_mutation();
create trigger consent_records_append_only
before update or delete on public.consent_records
for each row execute function public.prevent_enterprise_event_mutation();
create trigger governance_incident_events_append_only
before update or delete on public.governance_incident_events
for each row execute function public.prevent_enterprise_event_mutation();
create trigger retention_executions_append_only
before update or delete on public.retention_executions
for each row execute function public.prevent_enterprise_event_mutation();
create trigger integration_delivery_attempts_append_only
before update or delete on public.integration_delivery_attempts
for each row execute function public.prevent_enterprise_event_mutation();
create trigger workflow_run_events_append_only
before update or delete on public.workflow_run_events
for each row execute function public.prevent_enterprise_event_mutation();
create trigger security_events_append_only
before update or delete on public.security_events
for each row execute function public.prevent_enterprise_event_mutation();

create or replace function public.validate_consent_successor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.supersedes_id is not null
     and not exists (
       select 1
       from public.consent_records prior
       where prior.id = new.supersedes_id
         and prior.organization_id = new.organization_id
         and prior.subject_user_id = new.subject_user_id
         and prior.consent_type = new.consent_type
         and prior.policy_version = new.policy_version
         and prior.action <> new.action
     ) then
    raise exception 'Consent successor must alternate the same subject, type, and policy';
  end if;
  return new;
end;
$$;

create trigger consent_records_successor_guard
before insert on public.consent_records
for each row execute function public.validate_consent_successor();

create or replace function public.protect_enterprise_record_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_record jsonb;
  new_record jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception '% must be closed, disabled, expired, or revoked instead of deleted',
      tg_table_name;
  end if;

  old_record := to_jsonb(old);
  new_record := to_jsonb(new);

  if tg_table_name in (
       'governance_incidents', 'retention_policies', 'integration_endpoints'
     )
     and new_record -> 'organization_id'
       is distinct from old_record -> 'organization_id' then
    raise exception 'Tenant ownership is immutable for %', tg_table_name;
  end if;

  if tg_table_name = 'integration_webhook_messages'
     and (
       new_record -> 'organization_id' is distinct from old_record -> 'organization_id'
       or new_record -> 'endpoint_id' is distinct from old_record -> 'endpoint_id'
       or new_record -> 'direction' is distinct from old_record -> 'direction'
       or new_record -> 'event_type' is distinct from old_record -> 'event_type'
       or new_record -> 'payload_ciphertext' is distinct from old_record -> 'payload_ciphertext'
       or new_record -> 'encryption_key_reference' is distinct from old_record -> 'encryption_key_reference'
       or new_record -> 'payload_sha256' is distinct from old_record -> 'payload_sha256'
       or new_record -> 'idempotency_key' is distinct from old_record -> 'idempotency_key'
     ) then
    raise exception 'Webhook identity and encrypted payload fields are immutable';
  end if;

  if tg_table_name = 'workflow_definitions'
     and (
       new_record -> 'organization_id' is distinct from old_record -> 'organization_id'
       or new_record -> 'name' is distinct from old_record -> 'name'
       or new_record -> 'version' is distinct from old_record -> 'version'
       or new_record -> 'definition' is distinct from old_record -> 'definition'
       or new_record -> 'definition_sha256' is distinct from old_record -> 'definition_sha256'
     ) then
    raise exception 'Versioned workflow definition content is immutable';
  end if;

  if tg_table_name = 'api_client_credentials'
     and (
       new_record -> 'organization_id' is distinct from old_record -> 'organization_id'
       or new_record -> 'api_client_id' is distinct from old_record -> 'api_client_id'
       or new_record -> 'secret_hash' is distinct from old_record -> 'secret_hash'
       or new_record -> 'secret_fingerprint' is distinct from old_record -> 'secret_fingerprint'
       or new_record -> 'hash_algorithm' is distinct from old_record -> 'hash_algorithm'
       or new_record -> 'expires_at' is distinct from old_record -> 'expires_at'
     ) then
    raise exception 'API credential identity and hash fields are immutable';
  end if;

  if tg_table_name = 'api_clients'
     and (
       new_record -> 'organization_id' is distinct from old_record -> 'organization_id'
       or new_record -> 'client_identifier' is distinct from old_record -> 'client_identifier'
     ) then
    raise exception 'API client identity fields are immutable';
  end if;

  return new;
end;
$$;

create trigger governance_incidents_no_delete
before update or delete on public.governance_incidents
for each row execute function public.protect_enterprise_record_lifecycle();
create trigger retention_policies_no_delete
before update or delete on public.retention_policies
for each row execute function public.protect_enterprise_record_lifecycle();
create trigger integration_endpoints_no_delete
before update or delete on public.integration_endpoints
for each row execute function public.protect_enterprise_record_lifecycle();
create trigger integration_webhook_messages_lifecycle_guard
before update or delete on public.integration_webhook_messages
for each row execute function public.protect_enterprise_record_lifecycle();
create trigger reporting_exports_immutable
before update or delete on public.reporting_exports
for each row execute function public.prevent_enterprise_event_mutation();
create trigger workflow_definitions_lifecycle_guard
before update or delete on public.workflow_definitions
for each row execute function public.protect_enterprise_record_lifecycle();
create trigger api_clients_lifecycle_guard
before update or delete on public.api_clients
for each row execute function public.protect_enterprise_record_lifecycle();
create trigger api_client_credentials_lifecycle_guard
before update or delete on public.api_client_credentials
for each row execute function public.protect_enterprise_record_lifecycle();

create trigger governance_incidents_set_updated_at
before update on public.governance_incidents
for each row execute function public.set_updated_at();
create trigger retention_policies_set_updated_at
before update on public.retention_policies
for each row execute function public.set_updated_at();
create trigger integration_endpoints_set_updated_at
before update on public.integration_endpoints
for each row execute function public.set_updated_at();
create trigger integration_webhook_messages_set_updated_at
before update on public.integration_webhook_messages
for each row execute function public.set_updated_at();
create trigger reporting_jobs_set_updated_at
before update on public.reporting_jobs
for each row execute function public.set_updated_at();
create trigger workflow_definitions_set_updated_at
before update on public.workflow_definitions
for each row execute function public.set_updated_at();
create trigger workflow_runs_set_updated_at
before update on public.workflow_runs
for each row execute function public.set_updated_at();
create trigger api_clients_set_updated_at
before update on public.api_clients
for each row execute function public.set_updated_at();

alter table public.governance_audit_events enable row level security;
alter table public.consent_records enable row level security;
alter table public.governance_incidents enable row level security;
alter table public.governance_incident_events enable row level security;
alter table public.retention_policies enable row level security;
alter table public.retention_executions enable row level security;
alter table public.integration_endpoints enable row level security;
alter table public.integration_webhook_messages enable row level security;
alter table public.integration_delivery_attempts enable row level security;
alter table public.reporting_jobs enable row level security;
alter table public.reporting_exports enable row level security;
alter table public.workflow_definitions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_events enable row level security;
alter table public.security_events enable row level security;
alter table public.api_clients enable row level security;
alter table public.api_client_credentials enable row level security;

create policy governance_audit_events_admin_read
  on public.governance_audit_events for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
-- Audit writes are service-only and cannot be mutated after insertion.

create policy consent_records_subject_read
  on public.consent_records for select to authenticated
  using (
    subject_user_id = auth.uid()
    or public.has_organization_role(
      organization_id, array['tenant_admin']::public.member_role[]
    )
  );
create policy consent_records_capture
  on public.consent_records for insert to authenticated
  with check (
    public.is_organization_member(organization_id)
    and (
      subject_user_id = auth.uid()
      or public.has_organization_role(
        organization_id,
        array['tenant_admin', 'pharmacist']::public.member_role[]
      )
    )
    and captured_by = auth.uid()
  );

create policy governance_incidents_admin
  on public.governance_incidents for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
create policy governance_incident_events_admin_read
  on public.governance_incident_events for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));

create policy retention_policies_admin
  on public.retention_policies for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
create policy retention_executions_admin_read
  on public.retention_executions for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));

create policy integration_endpoints_admin
  on public.integration_endpoints for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
-- Webhook messages and delivery attempts are worker-only because payloads are
-- encrypted and operational metadata may still be sensitive.

create policy reporting_jobs_read
  on public.reporting_jobs for select to authenticated
  using (
    requested_by = auth.uid()
    or public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );
create policy reporting_jobs_create
  on public.reporting_jobs for insert to authenticated
  with check (
    requested_by = auth.uid()
    and public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin', 'pharmacy_owner']::public.member_role[]
    )
  );
create policy reporting_exports_read
  on public.reporting_exports for select to authenticated
  using (exists (
    select 1 from public.reporting_jobs job
    where job.id = reporting_job_id
      and (
        job.requested_by = auth.uid()
        or public.has_organization_role(
          job.organization_id,
          array['platform_admin', 'tenant_admin']::public.member_role[]
        )
      )
  ));

create policy workflow_definitions_admin
  on public.workflow_definitions for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
create policy workflow_runs_admin_read
  on public.workflow_runs for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
create policy workflow_run_events_admin_read
  on public.workflow_run_events for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));

create policy security_events_admin_read
  on public.security_events for select to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
-- Security-event writes are service-only and append-only.

create policy api_clients_admin
  on public.api_clients for all to authenticated
  using (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ))
  with check (public.has_organization_role(
    organization_id,
    array['platform_admin', 'tenant_admin']::public.member_role[]
  ));
-- Credential hashes are intentionally inaccessible through authenticated RLS.
-- Client provisioning and secret rotation use a privileged, audited service.

comment on table public.governance_audit_events is
  'Append-only governance audit. IP addresses and user agents are stored only as one-way hashes.';
comment on column public.governance_audit_events.metadata is
  'May contain sensitive identifiers; never store secrets, credentials, or document bodies.';
comment on table public.consent_records is
  'Append-only consent history. Revocation creates a new row linked through supersedes_id.';
comment on table public.governance_incidents is
  'Security/compliance incident case record; immutable case history is stored in governance_incident_events.';
comment on table public.retention_executions is
  'Append-only evidence of retention disposition using hashed resource references.';
comment on table public.integration_endpoints is
  'Integration configuration. Credentials and signing keys are external secret-manager references only.';
comment on table public.integration_webhook_messages is
  'Webhook payload is ciphertext; encryption key material remains in an external vault/KMS.';
comment on table public.integration_delivery_attempts is
  'Append-only webhook delivery evidence; response bodies are represented only by hashes.';
comment on table public.reporting_exports is
  'Potentially sensitive report object reference. Storage bucket must be private with equivalent authorization.';
comment on table public.workflow_definitions is
  'Versioned workflow definition. Embedded credentials and secret values are prohibited.';
comment on table public.workflow_run_events is
  'Append-only workflow execution history.';
comment on table public.security_events is
  'Append-only security telemetry using hashed network/device/resource identifiers.';
comment on table public.api_clients is
  'API client metadata and scopes; no secret material is stored in this table.';
comment on table public.api_client_credentials is
  'Credential verification hashes only. Plaintext client secrets are never persisted or returned.';
