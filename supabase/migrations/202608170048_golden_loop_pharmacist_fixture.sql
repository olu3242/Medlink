-- Complete the deterministic browser fixture with the licensed identity
-- required by clinical evidence RLS. This test-only authority remains
-- inaccessible to every application persona.
create or replace function public.certify_golden_loop_pharmacist_profile(
  target_organization_id uuid,
  target_pharmacist_id uuid,
  target_license_number text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     or target_license_number !~ '^PCN-[a-z0-9]{6,80}$'
     or not exists (
       select 1
       from public.organization_memberships membership
       where membership.organization_id = target_organization_id
         and membership.user_id = target_pharmacist_id
         and membership.role = 'pharmacist'::public.member_role
         and membership.deleted_at is null
     )
  then
    raise exception 'service-role pharmacist certification context required'
      using errcode = '42501';
  end if;

  insert into public.pharmacist_profiles(
    organization_id, user_id, license_number, issuing_authority,
    verification_status, is_active, license_expires_on, verified_by, verified_at
  ) values (
    target_organization_id, target_pharmacist_id, target_license_number, 'PCN',
    'verified', true, '2099-12-31', target_pharmacist_id, now()
  );
end;
$$;

revoke all on function public.certify_golden_loop_pharmacist_profile(uuid, uuid, text)
  from public;
grant execute on function public.certify_golden_loop_pharmacist_profile(uuid, uuid, text)
  to service_role;

comment on function public.certify_golden_loop_pharmacist_profile is
  'Test-only fixture authority for the browser golden loop; service_role only.';
