-- Wave 3: atomic MAR validation (created -> validated).
--
-- Found while investigating the next canonical workflow step: exhaustive
-- grep across every migration and every apps/* TypeScript file confirmed
-- no code path anywhere transitions a MAR out of `created`.
-- `enforce_and_audit_mar_state()` (migration 202607270003) already defines
-- `created -> validated` as legal and requires an idempotency key for any
-- transition, but nothing ever calls it -- meaning no MAR created via
-- `create_mar` (migration 202607290016) can ever progress at all. This is
-- the first of the missing links documented as a critical finding in
-- docs/audit/RC1_BACKLOG.md item 19; `validated -> reviewed` is closed by
-- the companion migration 202607290019. `searching`/`matched` remain open
-- -- see that item for why those two specifically are not closed here.
--
-- "Validated" requires no clinical judgment (that is `reviewed`'s job,
-- gated on a pharmacist's approved clinical_reviews row); it is the same
-- kind of administrative checkpoint `medication_access_requests_update`'s
-- existing RLS policy already scopes to clinical/pharmacy staff, so this
-- function re-enforces that exact policy rather than inventing a new
-- authorization rule.

create or replace function public.validate_mar(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_mar_id uuid
)
returns public.medication_access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  mar public.medication_access_requests;
  updated public.medication_access_requests;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  -- Mirrors the medication_access_requests_update RLS policy exactly:
  -- this function is SECURITY DEFINER and therefore bypasses RLS, so it
  -- must re-enforce the same authorization the policy would.
  if not public.has_organization_role(
    target_organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ) then
    raise exception 'Actor may not validate this medication access request';
  end if;

  select * into mar from public.medication_access_requests
  where id = target_mar_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then
    raise exception 'Medication access request not found';
  end if;

  -- Idempotent replay: already past created with the same transition key
  -- returns the current row rather than erroring or re-transitioning.
  if mar.state <> 'created' then
    if mar.transition_idempotency_key = target_idempotency_key then
      return mar;
    end if;
    raise exception 'Medication access request has already progressed past created';
  end if;

  -- `and state = 'created'` is load-bearing: two concurrent callers can
  -- both read `created` before either commits. Without this predicate in
  -- the UPDATE itself, a second transaction could re-run this transition
  -- (and its evidence commit) against a row a first transaction already
  -- moved on from. With it, only one UPDATE matches; the loser re-checks
  -- exactly like the idempotent-replay path above.
  update public.medication_access_requests
  set state = 'validated', transition_idempotency_key = target_idempotency_key
  where id = target_mar_id and organization_id = target_organization_id
    and state = 'created'
  returning * into updated;

  if not found then
    select * into mar from public.medication_access_requests
    where id = target_mar_id and organization_id = target_organization_id;
    if mar.transition_idempotency_key = target_idempotency_key then
      return mar;
    end if;
    raise exception 'Medication access request has already progressed past created';
  end if;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'mar.validate',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'medication_access_request', updated.id::text,
    jsonb_build_object('state', mar.state),
    jsonb_build_object('state', updated.state),
    null, null, target_channel, 'mar.validated',
    jsonb_build_object('marId', updated.id)
  );

  return updated;
end;
$$;

revoke all on function public.validate_mar(
  uuid, uuid, text, text, text, text, uuid
) from public;
grant execute on function public.validate_mar(
  uuid, uuid, text, text, text, text, uuid
) to authenticated;

comment on function public.validate_mar is
  'Atomic Wave 3 use case: transitions a MAR from created to validated and commits its runtime evidence in one transaction. The first of two migrations closing the previously entirely-unimplemented created->validated->reviewed chain (see migration 202607290019 and docs/audit/RC1_BACKLOG.md item 19).';
