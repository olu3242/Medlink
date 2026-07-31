-- Wave 3, Batch 3.1: Conversation Engine schema.
--
-- Backs packages/conversation (Conversation, ConversationMessage,
-- ConversationEvent) per docs/release-scope.md's Conversation-Driven
-- Architecture section: the Conversation Engine owns session management
-- and channel identity binding, conversation state, intent detection,
-- human handoff, and an append-only interaction/decision audit trail. It
-- owns no clinical, inventory, pricing, reservation, or payment rules --
-- this migration adds no such tables.
--
-- Inbound webhook processing has no authenticated end-user session: a
-- WhatsApp message arrives before any patient has signed in to anything.
-- The WhatsApp adapter (docs/audit/RC1_BACKLOG.md P1 item 15, not built in
-- this migration) verifies the provider's signature and writes through the
-- service role, the same "worker-only through the service role" pattern
-- notification_outbox/notification_delivery_attempts (migration
-- 202607270004) already established -- there is deliberately no
-- `authenticated` insert policy on conversation_messages/
-- conversation_events for the same reason. conversations itself does get
-- an authenticated insert/update policy, scoped to platform/tenant admins,
-- so support tooling built in a professional portal (Wave 4) can operate
-- on it without needing the service role.

create type public.conversation_channel as enum ('whatsapp');

create type public.conversation_status as enum (
  'active', 'awaiting_handoff', 'handed_off', 'closed'
);

create type public.message_direction as enum ('inbound', 'outbound');

create type public.message_content_type as enum (
  'text', 'image', 'document', 'template'
);

create type public.conversation_event_kind as enum (
  'message_received', 'message_sent', 'intent_detected', 'workflow_invoked',
  'handoff_requested', 'handoff_resolved', 'identity_linked'
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  patient_id uuid references auth.users(id),
  channel public.conversation_channel not null,
  channel_identity text not null check (char_length(channel_identity) between 1 and 64),
  status public.conversation_status not null default 'active',
  current_intent text,
  active_workflow_type text,
  active_workflow_instance_id uuid,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, channel, channel_identity)
);

create index conversations_patient_idx
  on public.conversations(patient_id)
  where deleted_at is null;
create index conversations_status_idx
  on public.conversations(organization_id, status)
  where deleted_at is null;

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction public.message_direction not null,
  external_message_id text,
  content_type public.message_content_type not null,
  body text,
  media_url text,
  created_at timestamptz not null default now(),
  -- external_message_id is null for outbound messages (Postgres treats
  -- multiple nulls as distinct, so this only constrains inbound provider
  -- deliveries); a repeated webhook delivery for the same provider message
  -- id hits this constraint rather than being recorded twice.
  unique (organization_id, external_message_id)
);

create index conversation_messages_conversation_idx
  on public.conversation_messages(conversation_id, created_at);

create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  kind public.conversation_event_kind not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index conversation_events_conversation_idx
  on public.conversation_events(conversation_id, created_at);

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

-- Reuses the append-only guard runtime_evidence_records (migration
-- 202607280007) and the enterprise governance/outbox tables (migration
-- 202607270005/06) already established, rather than a new mechanism, for
-- the same "decision audit trail" invariant: once a conversation event is
-- recorded, it cannot be edited or removed.
create trigger conversation_events_append_only
before update or delete on public.conversation_events
for each row execute function public.prevent_enterprise_event_mutation();

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_events enable row level security;

create policy conversations_read
  on public.conversations for select to authenticated
  using (
    deleted_at is null
    and (
      patient_id = auth.uid()
      or public.has_organization_role(
        organization_id,
        array['platform_admin', 'tenant_admin']::public.member_role[]
      )
    )
  );
create policy conversations_admin_manage
  on public.conversations for all to authenticated
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

create policy conversation_messages_read
  on public.conversation_messages for select to authenticated
  using (exists (
    select 1 from public.conversations conversation
    where conversation.id = conversation_id
      and conversation.deleted_at is null
      and (
        conversation.patient_id = auth.uid()
        or public.has_organization_role(
          conversation.organization_id,
          array['platform_admin', 'tenant_admin']::public.member_role[]
        )
      )
  ));
-- No authenticated insert/update/delete policy: conversation_messages is
-- worker-only through the service role (see file header).

create policy conversation_events_read
  on public.conversation_events for select to authenticated
  using (exists (
    select 1 from public.conversations conversation
    where conversation.id = conversation_id
      and conversation.deleted_at is null
      and public.has_organization_role(
        conversation.organization_id,
        array['platform_admin', 'tenant_admin']::public.member_role[]
      )
  ));
-- No authenticated insert policy: conversation_events is worker-only
-- through the service role (see file header), and update/delete is
-- blocked outright by conversation_events_append_only above regardless of
-- role.

comment on table public.conversations is
  'Wave 3 Conversation Engine aggregate root: session/channel-identity binding, dialogue state, and human handoff -- owns no business rules.';
comment on table public.conversation_messages is
  'Inbound/outbound message log for a conversation. Worker-only writes (service role); deduplicated on (organization_id, external_message_id) for inbound provider deliveries.';
comment on table public.conversation_events is
  'Append-only interaction/decision audit trail for a conversation (intent detected, workflow invoked, handoff requested/resolved, identity linked).';
