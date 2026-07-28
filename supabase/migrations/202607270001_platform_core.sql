create extension if not exists pgcrypto;

create type public.organization_type as enum (
  'hospital', 'clinic', 'pharmacy', 'hmo', 'manufacturer',
  'distributor', 'ngo', 'government'
);

create type public.member_role as enum (
  'platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_owner',
  'pharmacy_staff', 'inventory_manager', 'patient'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  type public.organization_type not null,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, user_id)
);

create index organization_memberships_user_idx
  on public.organization_memberships(user_id)
  where deleted_at is null;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.deleted_at is null
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.role = any(allowed_roles)
      and membership.deleted_at is null
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
revoke all on function public.has_organization_role(uuid, public.member_role[]) from public;
grant execute on function public.has_organization_role(uuid, public.member_role[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.organization_memberships enable row level security;

create policy organizations_select_member
  on public.organizations for select to authenticated
  using (public.is_organization_member(id));

create policy profiles_select_self
  on public.user_profiles for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self
  on public.user_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_select_same_tenant
  on public.organization_memberships for select to authenticated
  using (public.is_organization_member(organization_id));

create policy memberships_manage_admin
  on public.organization_memberships for all to authenticated
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

comment on table public.user_profiles is
  'Contains PII: display_name. Access is restricted to the subject user.';
