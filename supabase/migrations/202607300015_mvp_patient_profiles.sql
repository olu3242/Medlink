-- RC2 MVP: patient contact and communication preferences.

create table public.patient_profiles (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_phone text check (
    whatsapp_phone is null
    or whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$'
  ),
  date_of_birth date check (
    date_of_birth is null
    or (date_of_birth <= current_date and date_of_birth > date '1900-01-01')
  ),
  address jsonb not null check (
    address ?& array['line1', 'city', 'state', 'countryCode']
    and address ->> 'countryCode' = 'NG'
  ),
  preferences jsonb not null default
    '{"preferredLanguage":"en","whatsappOptIn":false,"emailOptIn":false}'::jsonb
    check (
      preferences ?& array[
        'preferredLanguage', 'whatsappOptIn', 'emailOptIn'
      ]
      and preferences ->> 'preferredLanguage' in ('en', 'yo', 'ig', 'ha')
      and jsonb_typeof(preferences -> 'whatsappOptIn') = 'boolean'
      and jsonb_typeof(preferences -> 'emailOptIn') = 'boolean'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (organization_id, user_id)
);

create index patient_profiles_user_idx
  on public.patient_profiles(user_id)
  where deleted_at is null;

create trigger patient_profiles_set_updated_at
before update on public.patient_profiles
for each row execute function public.set_updated_at();

alter table public.patient_profiles enable row level security;

create policy patient_profiles_self_read
  on public.patient_profiles for select to authenticated
  using (
    user_id = auth.uid()
    and public.is_organization_member(organization_id)
    and deleted_at is null
  );

create policy patient_profiles_self_create
  on public.patient_profiles for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_organization_role(
      organization_id,
      array['patient']::public.member_role[]
    )
    and deleted_at is null
  );

create policy patient_profiles_self_update
  on public.patient_profiles for update to authenticated
  using (
    user_id = auth.uid()
    and public.has_organization_role(
      organization_id,
      array['patient']::public.member_role[]
    )
    and deleted_at is null
  )
  with check (
    user_id = auth.uid()
    and public.has_organization_role(
      organization_id,
      array['patient']::public.member_role[]
    )
  );

create policy patient_profiles_admin_read
  on public.patient_profiles for select to authenticated
  using (
    public.has_organization_role(
      organization_id,
      array['platform_admin', 'tenant_admin']::public.member_role[]
    )
  );

create policy patient_profiles_admin_manage
  on public.patient_profiles for all to authenticated
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

comment on table public.patient_profiles is
  'MVP patient contact, Lagos pilot address, and communication preferences.';
