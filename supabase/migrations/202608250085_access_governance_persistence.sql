-- Forward-only persistence for organization access governance. This migration
-- extends canonical organization_memberships/auth.uid() authorization and does
-- not enable Test-As subject exchange.

alter table public.organization_memberships
  add constraint organization_memberships_id_org_unique unique (id, organization_id);

create table public.permission_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (char_length(name) between 2 and 100),
  description text,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table public.permission_set_capabilities (
  permission_set_id uuid not null references public.permission_sets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  capability text not null check (capability ~ '^[a-z_]+:[a-z_]+$'),
  effect text not null check (effect in ('allow','deny')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (permission_set_id, capability),
  foreign key (permission_set_id, organization_id) references public.permission_sets(id, organization_id)
);

create table public.membership_permission_sets (
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  permission_set_id uuid not null references public.permission_sets(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (membership_id, permission_set_id),
  foreign key (membership_id, organization_id) references public.organization_memberships(id, organization_id),
  foreign key (permission_set_id, organization_id) references public.permission_sets(id, organization_id)
);

create table public.organization_field_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  resource text not null check (resource ~ '^[a-z][a-z0-9_]*$'),
  field_name text not null check (field_name ~ '^[a-z][a-z0-9_]*$'),
  role public.member_role,
  permission_set_id uuid references public.permission_sets(id) on delete cascade,
  scope text not null default 'all_organization' check (scope in ('all_organization','selected_pharmacies','selected_locations','own_location','own_records')),
  access_level text not null check (access_level in ('hidden','masked','read_only','editable')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role is null) <> (permission_set_id is null))
);

create table public.organization_scope_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  membership_id uuid references public.organization_memberships(id) on delete cascade,
  permission_set_id uuid references public.permission_sets(id) on delete cascade,
  scope text not null check (scope in ('all_organization','selected_pharmacies','selected_locations','own_location','own_records')),
  pharmacy_id uuid references public.organizations(id),
  location_id uuid references public.pharmacy_locations(id),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (membership_id is not null or permission_set_id is not null)
);

create table public.access_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  version integer not null check (version > 0),
  policy_hash text not null check (policy_hash ~ '^[a-f0-9]{64}$'),
  change_summary text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, version)
);

create table public.access_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  membership_id uuid not null references public.organization_memberships(id),
  policy_version_id uuid references public.access_policy_versions(id),
  status text not null check (status in ('pending','approved','changes_required','revoked')),
  decision_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_as_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  subject_user_id uuid not null references auth.users(id),
  membership_id uuid not null references public.organization_memberships(id),
  organization_id uuid not null references public.organizations(id),
  role public.member_role not null,
  pharmacy_id uuid references public.organizations(id),
  location_id uuid references public.pharmacy_locations(id),
  purpose text not null check (char_length(purpose) between 8 and 500),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  revoked_at timestamptz,
  status text not null check (status in ('active','ended','revoked','expired')),
  created_at timestamptz not null default now(),
  check (actor_user_id <> subject_user_id),
  check (expires_at > started_at),
  check (expires_at <= started_at + interval '30 minutes')
);

create index permission_sets_org_idx on public.permission_sets(organization_id) where is_active;
create index permission_capabilities_org_idx on public.permission_set_capabilities(organization_id, capability);
create index membership_permission_sets_org_idx on public.membership_permission_sets(organization_id, membership_id);
create index organization_field_rules_lookup_idx on public.organization_field_rules(organization_id, resource, field_name);
create index organization_scope_rules_lookup_idx on public.organization_scope_rules(organization_id, membership_id);
create index access_reviews_pending_idx on public.access_reviews(organization_id, created_at) where status = 'pending';
create index test_as_sessions_actor_idx on public.test_as_sessions(actor_user_id, started_at desc);
create index test_as_sessions_subject_idx on public.test_as_sessions(subject_user_id, started_at desc);

create or replace function public.enforce_access_governance_tenant_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.membership_id is not null and not exists (
    select 1 from public.organization_memberships m where m.id = new.membership_id and m.organization_id = new.organization_id and m.deleted_at is null
  ) then raise exception 'membership is outside organization'; end if;
  if new.permission_set_id is not null and not exists (
    select 1 from public.permission_sets p where p.id = new.permission_set_id and p.organization_id = new.organization_id
  ) then raise exception 'permission set is outside organization'; end if;
  if new.pharmacy_id is not null and new.pharmacy_id <> new.organization_id then raise exception 'pharmacy is outside organization'; end if;
  if new.location_id is not null and not exists (
    select 1 from public.pharmacy_locations l where l.id = new.location_id and l.organization_id = new.organization_id and l.deleted_at is null
  ) then raise exception 'location is outside organization'; end if;
  return new;
end $$;

create trigger organization_scope_rules_tenant_integrity before insert or update on public.organization_scope_rules for each row execute function public.enforce_access_governance_tenant_integrity();

create or replace function public.enforce_test_as_tenant_integrity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organization_memberships m where m.id = new.membership_id and m.organization_id = new.organization_id and m.user_id = new.subject_user_id and m.role = new.role and m.deleted_at is null
  ) then raise exception 'subject membership is outside organization or does not match role'; end if;
  if new.pharmacy_id is not null and new.pharmacy_id <> new.organization_id then raise exception 'pharmacy is outside organization'; end if;
  if new.location_id is not null and not exists (
    select 1 from public.pharmacy_locations l where l.id = new.location_id and l.organization_id = new.organization_id and l.deleted_at is null
  ) then raise exception 'location is outside organization'; end if;
  return new;
end $$;
create trigger test_as_sessions_tenant_integrity before insert or update on public.test_as_sessions for each row execute function public.enforce_test_as_tenant_integrity();

create or replace function public.enforce_permission_capability_delegation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.capability in ('platform_admin','cross_tenant_access','migration_administration','service_role_operations','global_security_configuration','platform_test_as','global_settlement_administration') then
    raise exception 'capability is non-delegable';
  end if;
  return new;
end $$;
create trigger permission_capability_non_delegable before insert or update on public.permission_set_capabilities for each row execute function public.enforce_permission_capability_delegation();

alter table public.permission_sets enable row level security;
alter table public.permission_set_capabilities enable row level security;
alter table public.membership_permission_sets enable row level security;
alter table public.organization_field_rules enable row level security;
alter table public.organization_scope_rules enable row level security;
alter table public.access_policy_versions enable row level security;
alter table public.access_reviews enable row level security;
alter table public.test_as_sessions enable row level security;

create policy permission_sets_member_read on public.permission_sets for select to authenticated using (public.is_organization_member(organization_id));
create policy permission_sets_admin_manage on public.permission_sets for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));
create policy permission_set_capabilities_member_read on public.permission_set_capabilities for select to authenticated using (public.is_organization_member(organization_id));
create policy permission_set_capabilities_admin_manage on public.permission_set_capabilities for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));
create policy membership_permission_sets_member_read on public.membership_permission_sets for select to authenticated using (public.is_organization_member(organization_id));
create policy membership_permission_sets_admin_manage on public.membership_permission_sets for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));
create policy organization_field_rules_member_read on public.organization_field_rules for select to authenticated using (public.is_organization_member(organization_id));
create policy organization_field_rules_admin_manage on public.organization_field_rules for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));
create policy organization_scope_rules_member_read on public.organization_scope_rules for select to authenticated using (public.is_organization_member(organization_id));
create policy organization_scope_rules_admin_manage on public.organization_scope_rules for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));
create policy access_policy_versions_member_read on public.access_policy_versions for select to authenticated using (public.is_organization_member(organization_id));
create policy access_policy_versions_admin_manage on public.access_policy_versions for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));
create policy access_reviews_member_read on public.access_reviews for select to authenticated using (public.is_organization_member(organization_id));
create policy access_reviews_admin_manage on public.access_reviews for all to authenticated using (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[])) with check (public.has_organization_role(organization_id, array['platform_admin','tenant_admin']::public.member_role[]));

create policy test_as_sessions_platform_admin_read on public.test_as_sessions for select to authenticated
using (actor_user_id = auth.uid() and public.has_organization_role(organization_id, array['platform_admin']::public.member_role[]));
-- No INSERT/UPDATE/DELETE policy is intentionally provided. Metadata may only
-- be written by a separately reviewed server-side exchange implementation.

revoke all on table public.permission_sets, public.permission_set_capabilities, public.membership_permission_sets, public.organization_field_rules, public.organization_scope_rules, public.access_policy_versions, public.access_reviews, public.test_as_sessions from anon;
grant select,insert,update,delete on table public.permission_sets, public.permission_set_capabilities, public.membership_permission_sets, public.organization_field_rules, public.organization_scope_rules, public.access_policy_versions, public.access_reviews to authenticated;
grant select on table public.test_as_sessions to authenticated;
grant all on table public.permission_sets, public.permission_set_capabilities, public.membership_permission_sets, public.organization_field_rules, public.organization_scope_rules, public.access_policy_versions, public.access_reviews, public.test_as_sessions to service_role;

comment on table public.test_as_sessions is 'Metadata only. Never stores tokens. Does not itself authorize subject impersonation.';
