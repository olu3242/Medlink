-- Production-valid portal persona onboarding.
-- Patient workspaces are self-bootstrapable but can only grant the patient role.
-- Pharmacy locations and pharmacist authority remain behind the governed Partner Engine.

create or replace function public.bootstrap_patient_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  workspace_id uuid;
  workspace_slug text;
begin
  if actor_id is null or not exists (
    select 1 from auth.users where id = actor_id and email_confirmed_at is not null
  ) then
    raise exception 'A verified authenticated identity is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));

  insert into public.user_profiles(id, display_name)
  values (actor_id, 'MedLink Patient')
  on conflict (id) do nothing;

  select membership.organization_id into workspace_id
  from public.organization_memberships membership
  where membership.user_id = actor_id
    and membership.role = 'patient'::public.member_role
    and membership.deleted_at is null
  order by membership.created_at
  limit 1;
  if workspace_id is not null then return workspace_id; end if;

  if exists (
    select 1 from public.organization_memberships membership
    where membership.user_id = actor_id and membership.deleted_at is null
  ) then
    raise exception 'A privileged identity cannot self-enroll as a patient'
      using errcode = '42501';
  end if;

  workspace_slug := 'patient-' || replace(actor_id::text, '-', '');
  insert into public.organizations(name, slug, type, branding)
  values ('Patient workspace', workspace_slug, 'clinic', '{"workspace":"patient"}'::jsonb)
  returning id into workspace_id;

  insert into public.organization_memberships(organization_id, user_id, role)
  values (workspace_id, actor_id, 'patient');

  return workspace_id;
end;
$$;

revoke all on function public.bootstrap_patient_workspace() from public, anon;
grant execute on function public.bootstrap_patient_workspace() to authenticated;

create or replace function public.create_partner_pharmacy_location(
  target_application_id uuid,
  target_name text,
  target_license_number text,
  target_address_line_1 text,
  target_locality text,
  target_country_code text,
  target_latitude numeric,
  target_longitude numeric,
  target_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.partner_applications;
  location_id uuid;
begin
  select * into application from public.partner_applications
  where id = target_application_id for update;
  if not found
    or application.applicant_user_id is distinct from auth.uid()
    or application.partner_type not in ('pharmacy', 'pharmacy_chain')
    or application.organization_id is null
    or application.relationship_status not in ('approved', 'active')
    or not public.has_organization_role(
      application.organization_id,
      array['pharmacy_owner']::public.member_role[]
    )
  then
    raise exception 'Approved pharmacy owner access is required' using errcode = '42501';
  end if;
  if char_length(btrim(target_name)) < 2
    or char_length(btrim(target_license_number)) < 3
    or char_length(btrim(target_address_line_1)) < 3
    or char_length(btrim(target_locality)) < 2
    or target_country_code !~ '^[A-Za-z]{2}$'
    or target_latitude not between -90 and 90
    or target_longitude not between -180 and 180
    or char_length(btrim(target_idempotency_key)) < 8
  then
    raise exception 'Valid pharmacy location evidence is required';
  end if;

  select id into location_id from public.pharmacy_locations
  where organization_id = application.organization_id
    and country_code = upper(target_country_code)
    and license_number = btrim(target_license_number)
    and deleted_at is null;
  if location_id is not null then return location_id; end if;

  insert into public.pharmacy_locations(
    organization_id, name, license_number, address_line_1, locality,
    country_code, latitude, longitude
  ) values (
    application.organization_id, btrim(target_name), btrim(target_license_number),
    btrim(target_address_line_1), btrim(target_locality), upper(target_country_code),
    target_latitude, target_longitude
  ) returning id into location_id;

  perform public.record_partner_event(
    application.id, auth.uid(), 'partner.pharmacy-location.created.v1',
    application.relationship_status, application.relationship_status,
    application.onboarding_stage, application.onboarding_stage,
    'Applicant supplied a licensed pharmacy location',
    target_idempotency_key, target_idempotency_key
  );
  return location_id;
end;
$$;

revoke all on function public.create_partner_pharmacy_location(
  uuid, text, text, text, text, text, numeric, numeric, text
) from public, anon;
grant execute on function public.create_partner_pharmacy_location(
  uuid, text, text, text, text, text, numeric, numeric, text
) to authenticated;

create or replace function public.assign_partner_pharmacist(
  target_application_id uuid,
  target_email text,
  target_license_number text,
  target_issuing_authority text,
  target_license_expires_on date,
  target_reason text,
  target_idempotency_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  application public.partner_applications;
  pharmacist_id uuid;
  existing_role public.member_role;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator role required' using errcode = '42501';
  end if;
  select * into application from public.partner_applications
  where id = target_application_id for update;
  if not found or application.organization_id is null
    or application.partner_type not in ('pharmacy', 'pharmacy_chain')
    or application.relationship_status <> 'active'
  then
    raise exception 'An active pharmacy relationship is required';
  end if;
  if char_length(btrim(target_license_number)) < 3
    or char_length(btrim(target_issuing_authority)) < 2
    or target_license_expires_on < current_date
    or char_length(btrim(target_reason)) < 10
    or char_length(btrim(target_idempotency_key)) < 8
  then
    raise exception 'Complete pharmacist credential evidence is required';
  end if;

  select id into pharmacist_id from auth.users
  where lower(email) = lower(btrim(target_email)) and email_confirmed_at is not null;
  if pharmacist_id is null then raise exception 'Verified pharmacist identity not found'; end if;
  if pharmacist_id = auth.uid() then raise exception 'Self-verification is prohibited' using errcode = '42501'; end if;

  select role into existing_role from public.organization_memberships
  where organization_id = application.organization_id
    and user_id = pharmacist_id and deleted_at is null;
  if existing_role is not null and existing_role <> 'pharmacist'::public.member_role then
    raise exception 'Identity already holds a different organization role';
  end if;

  insert into public.user_profiles(id, display_name)
  values (pharmacist_id, 'MedLink Pharmacist')
  on conflict (id) do nothing;
  insert into public.organization_memberships(organization_id, user_id, role)
  values (application.organization_id, pharmacist_id, 'pharmacist')
  on conflict (organization_id, user_id) do update set
    role = 'pharmacist', deleted_at = null;
  insert into public.pharmacist_profiles(
    organization_id, user_id, license_number, issuing_authority,
    verification_status, is_active, license_expires_on, verified_by, verified_at
  ) values (
    application.organization_id, pharmacist_id, btrim(target_license_number),
    btrim(target_issuing_authority), 'verified', true,
    target_license_expires_on, auth.uid(), now()
  )
  on conflict (organization_id, user_id) do update set
    license_number = excluded.license_number,
    issuing_authority = excluded.issuing_authority,
    verification_status = 'verified', is_active = true,
    license_expires_on = excluded.license_expires_on,
    verified_by = auth.uid(), verified_at = now();

  perform public.record_partner_event(
    application.id, auth.uid(), 'partner.pharmacist.verified.v1',
    application.relationship_status, application.relationship_status,
    application.onboarding_stage, application.onboarding_stage,
    btrim(target_reason), target_idempotency_key, target_idempotency_key
  );
  return pharmacist_id;
end;
$$;

revoke all on function public.assign_partner_pharmacist(
  uuid, text, text, text, date, text, text
) from public, anon;
grant execute on function public.assign_partner_pharmacist(
  uuid, text, text, text, date, text, text
) to authenticated;
