-- Track A S01.8: transactional runtime evidence, durable outbox, and recovery.

create type public.runtime_event_status as enum (
  'pending', 'publishing', 'published', 'retrying', 'dead_letter'
);

alter table public.governance_audit_events
  add column previous_state jsonb,
  add column new_state jsonb,
  add column workflow_id text,
  add column conversation_id text,
  add column source_channel text not null default 'api';

create table public.runtime_outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  event_type text not null check (char_length(event_type) between 3 and 160),
  aggregate_type text not null check (char_length(aggregate_type) between 2 and 120),
  aggregate_id text,
  payload jsonb not null default '{}'::jsonb,
  status public.runtime_event_status not null default 'pending',
  correlation_id text not null,
  request_id text not null,
  workflow_id text,
  conversation_id text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  check (
    payload::text !~* '"(password|secret|token|api_key|private_key|credential|card_number|cvv|cvc)"[[:space:]]*:'
  )
);

create index runtime_outbox_dispatch_idx
  on public.runtime_outbox_events(status, available_at, created_at)
  where status in ('pending', 'retrying');
create index runtime_outbox_correlation_idx
  on public.runtime_outbox_events(organization_id, correlation_id);
create index runtime_outbox_aggregate_idx
  on public.runtime_outbox_events(
    organization_id, aggregate_type, aggregate_id, created_at
  );

create table public.runtime_idempotency_keys (
  organization_id uuid not null references public.organizations(id),
  operation text not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[A-Fa-f0-9]{64}$'),
  status text not null check (status in ('processing', 'completed', 'failed')),
  response_status integer,
  response_body jsonb,
  correlation_id text not null,
  locked_until timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organization_id, operation, idempotency_key),
  check (expires_at > created_at)
);

create index runtime_idempotency_expiry_idx
  on public.runtime_idempotency_keys(expires_at);

create table public.runtime_dead_letters (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  outbox_event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  error_code text not null,
  error_detail text,
  correlation_id text not null,
  retry_count integer not null check (retry_count >= 0),
  failed_at timestamptz not null default now(),
  replayed_at timestamptz,
  replayed_by uuid references auth.users(id),
  foreign key (outbox_event_id, organization_id)
    references public.runtime_outbox_events(id, organization_id)
    on delete restrict
);

create index runtime_dead_letters_queue_idx
  on public.runtime_dead_letters(organization_id, failed_at)
  where replayed_at is null;

create trigger runtime_dead_letters_append_only
before update or delete on public.runtime_dead_letters
for each row execute function public.prevent_enterprise_event_mutation();

create or replace function public.record_runtime_evidence(
  target_organization_id uuid,
  target_actor_id uuid,
  target_operation text,
  target_outcome text,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_resource_type text,
  target_resource_id text,
  target_previous_state jsonb,
  target_new_state jsonb,
  target_workflow_id text,
  target_conversation_id text,
  target_source_channel text,
  target_event_type text,
  target_event_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox_id uuid;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) then
    raise exception 'Tenant membership is invalid';
  end if;
  if target_outcome not in ('success', 'denied', 'failure') then
    raise exception 'Invalid runtime outcome';
  end if;

  insert into public.runtime_outbox_events (
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, workflow_id, conversation_id, idempotency_key
  ) values (
    target_organization_id, target_event_type, target_resource_type,
    target_resource_id, coalesce(target_event_payload, '{}'::jsonb),
    target_correlation_id, target_request_id, target_workflow_id,
    target_conversation_id, target_idempotency_key || ':event'
  )
  on conflict (organization_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into outbox_id;

  insert into public.governance_audit_events (
    organization_id, event_type, actor_id, actor_type, resource_type,
    resource_id, action, outcome, correlation_id, request_id,
    idempotency_key, previous_state, new_state, workflow_id,
    conversation_id, source_channel, metadata
  ) values (
    target_organization_id, 'runtime.operation', target_actor_id, 'user',
    target_resource_type, target_resource_id, target_operation, target_outcome,
    target_correlation_id, target_request_id,
    target_idempotency_key || ':audit', target_previous_state,
    target_new_state, target_workflow_id, target_conversation_id,
    target_source_channel, jsonb_build_object('outbox_event_id', outbox_id)
  )
  on conflict (organization_id, idempotency_key) do nothing;

  return outbox_id;
end;
$$;

revoke all on function public.record_runtime_evidence(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb,
  text, text, text, text, jsonb
) from public;
grant execute on function public.record_runtime_evidence(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb,
  text, text, text, text, jsonb
) to authenticated;

alter table public.runtime_outbox_events enable row level security;
alter table public.runtime_idempotency_keys enable row level security;
alter table public.runtime_dead_letters enable row level security;

create policy runtime_outbox_admin_read
  on public.runtime_outbox_events for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

create policy runtime_idempotency_member_read
  on public.runtime_idempotency_keys for select to authenticated
  using (public.is_organization_member(organization_id));

create policy runtime_dead_letters_admin_read
  on public.runtime_dead_letters for select to authenticated
  using (
    public.has_organization_role(
      organization_id, array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

comment on table public.runtime_outbox_events is
  'Durable transactional domain-event outbox. Dispatchers use privileged workload identity.';
comment on table public.runtime_idempotency_keys is
  'Tenant-scoped duplicate request claims and replayable safe responses.';
comment on table public.runtime_dead_letters is
  'Immutable failed-event evidence. Replay is recorded through an audited privileged command.';
