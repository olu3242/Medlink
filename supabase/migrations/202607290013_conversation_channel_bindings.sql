-- Wave 3, Batch 3.1: conversation channel identity binding.
--
-- Per docs/release-scope.md's Conversation-Driven Architecture section, the
-- Conversation Engine owns "session management and channel identity
-- binding" -- resolving which organization a channel message belongs to.
-- A WhatsApp Business phone number is provisioned per organization
-- (migration 202607290012's `conversations.channel_identity` is the
-- *patient's* number; this table is the organization's own number the
-- webhook was delivered to). packages/whatsapp's payload normalizer
-- extracts `phone_number_id` from the Cloud API payload; this table is
-- what a future webhook route joins against to resolve `organization_id`
-- before anything else can happen.
--
-- Not built in this migration: the webhook route itself. Doing so requires
-- extending how a RuntimeContext gets constructed for an unauthenticated
-- provider callback (`packages/runtime`'s `runtimeContextSchema` currently
-- requires `userId` as a non-optional UUID, which a webhook never has --
-- see docs/audit/RC1_BACKLOG.md P1 item 15 and CERTIFICATION_GAP.md for the
-- full finding). That is a frozen-platform change needing its own ADR, not
-- a schema addition, so this migration stops at the binding table.

create table public.conversation_channel_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  channel public.conversation_channel not null,
  channel_identifier text not null check (char_length(channel_identifier) between 1 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- One organization's channel number can only ever resolve to one
  -- organization: a provider identifier is globally unique per channel,
  -- never shared across tenants.
  unique (channel, channel_identifier)
);

create index conversation_channel_bindings_org_idx
  on public.conversation_channel_bindings(organization_id)
  where deleted_at is null;

create trigger conversation_channel_bindings_set_updated_at
before update on public.conversation_channel_bindings
for each row execute function public.set_updated_at();

alter table public.conversation_channel_bindings enable row level security;

create policy conversation_channel_bindings_read
  on public.conversation_channel_bindings for select to authenticated
  using (
    deleted_at is null
    and public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );
create policy conversation_channel_bindings_admin_manage
  on public.conversation_channel_bindings for all to authenticated
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

comment on table public.conversation_channel_bindings is
  'Maps a provider channel identifier (e.g. a WhatsApp Business phone_number_id) to the organization it belongs to, resolved before any conversation/tenant context can be constructed for an inbound provider webhook.';
