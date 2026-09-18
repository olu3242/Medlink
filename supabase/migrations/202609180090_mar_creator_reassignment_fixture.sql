-- Service-role-only fixture for clinical-review-self-review-live.test.ts
-- (authorization convergence repair, item 6). Same posture as
-- certify_medication_golden_loop_fixture (202608170041): service_role only
-- has SELECT granted on medication_access_requests
-- (202608150033_reservation_fulfillment_read_grants.sql), by design -- so a
-- live test cannot reassign a MAR's created_by via a direct table update
-- the way it can read fixture data. organization_memberships also has a
-- unique (organization_id, user_id) constraint (one role per user per org),
-- so the self-review scenario -- one person is both the MAR's creator and
-- the deciding pharmacist -- cannot be produced by passing the same id
-- twice into certify_medication_golden_loop_fixture either (it would try to
-- insert that id twice with different roles). This fixture provisions a
-- normal, distinct fixture patient via certify_medication_golden_loop_fixture
-- and then reassigns just the MAR's created_by to the reviewing pharmacist,
-- producing the exact condition decide_clinical_review's self-review guard
-- exists to catch.
create or replace function public.certify_mar_creator_reassignment_fixture(
  fixture_key text,
  target_mar_id uuid,
  new_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;
  update public.medication_access_requests
  set created_by = new_created_by
  where id = target_mar_id;
end;
$$;

revoke all on function public.certify_mar_creator_reassignment_fixture(text, uuid, uuid) from public;
grant execute on function public.certify_mar_creator_reassignment_fixture(text, uuid, uuid) to service_role;

comment on function public.certify_mar_creator_reassignment_fixture is
  'Test-only fixture for clinical-review-self-review-live.test.ts: reassigns a medication_access_requests row''s created_by, which service_role otherwise has no UPDATE grant to do directly. Not part of the application runtime; granted to service_role only.';
