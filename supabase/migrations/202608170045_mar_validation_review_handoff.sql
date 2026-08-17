-- RC2 convergence: validation creates the existing clinical-review handoff
-- atomically. Previously only service-role fixtures could create it.
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
  review public.clinical_reviews;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ) then
    raise exception 'Actor may not validate this medication access request';
  end if;

  select * into mar from public.medication_access_requests
  where id = target_mar_id and organization_id = target_organization_id
    and deleted_at is null;
  if not found then raise exception 'Medication access request not found'; end if;

  if mar.state <> 'created' then
    if mar.transition_idempotency_key = target_idempotency_key then return mar; end if;
    raise exception 'Medication access request has already progressed past created';
  end if;

  update public.medication_access_requests
  set state = 'validated', transition_idempotency_key = target_idempotency_key
  where id = target_mar_id and organization_id = target_organization_id
    and state = 'created'
  returning * into updated;

  if not found then
    select * into mar from public.medication_access_requests
    where id = target_mar_id and organization_id = target_organization_id;
    if mar.transition_idempotency_key = target_idempotency_key then return mar; end if;
    raise exception 'Medication access request has already progressed past created';
  end if;

  insert into public.clinical_reviews(
    organization_id, mar_id, prescription_id, decision, idempotency_key
  ) values (
    target_organization_id, updated.id, updated.prescription_id, 'pending',
    target_idempotency_key || ':clinical-review'
  )
  on conflict (organization_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning * into review;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'mar.validate',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'medication_access_request', updated.id::text,
    jsonb_build_object('state', mar.state),
    jsonb_build_object('state', updated.state, 'reviewId', review.id),
    null, null, target_channel, 'mar.validated',
    jsonb_build_object('marId', updated.id, 'reviewId', review.id)
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
  'Atomically validates a MAR, creates its pending clinical review handoff, and records runtime evidence. Idempotent and pharmacist/pharmacy-staff only.';
