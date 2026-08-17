-- WhatsApp is a channel, never an identity authority. Only an explicitly
-- verified link plus an active membership may resolve a sender to a user.
create type public.channel_identity_link_status as enum ('pending', 'verified', 'revoked');

create table public.channel_identity_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  channel public.conversation_channel not null,
  channel_identity text not null check (char_length(channel_identity) between 1 and 64),
  user_id uuid not null references auth.users(id),
  status public.channel_identity_link_status not null default 'pending',
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, channel_identity),
  check ((status = 'verified' and verified_at is not null and verified_by is not null)
    or status <> 'verified')
);

create trigger channel_identity_links_set_updated_at before update
on public.channel_identity_links for each row execute function public.set_updated_at();

alter table public.channel_identity_links enable row level security;
create policy channel_identity_links_admin_read on public.channel_identity_links
for select to authenticated using (public.has_organization_role(
  organization_id, array['platform_admin', 'tenant_admin']::public.member_role[]
));
revoke insert, update, delete on public.channel_identity_links from authenticated;
grant select on public.channel_identity_links to authenticated, service_role;

comment on table public.channel_identity_links is
  'Verified channel-to-user links. A phone number alone never grants identity, membership, tenant context, or permission.';
