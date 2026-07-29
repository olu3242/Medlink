-- Wave 3: complete the validated -> reviewed transition on approval.
--
-- The second of two migrations closing the previously entirely
-- unimplemented created -> validated -> reviewed chain (migration
-- 202607290018 closed created -> validated). enforce_and_audit_mar_state()
-- (migration 202607270003) has always required an *existing* approved
-- clinical_reviews row before it will allow a MAR into 'reviewed' --
-- meaning decide_clinical_review (migration 202607290017) approving a
-- review was always the trigger's implicit precondition for this
-- transition, but nothing ever performed it. This is not a new business
-- rule; it is completing what decide_clinical_review's own target state's
-- precondition already assumed would happen.
--
-- Re-created here (create or replace, identical signature) rather than
-- editing migration 202607290017 in place, matching this session's
-- consistent practice of never rewriting an earlier migration file.

create or replace function public.decide_clinical_review(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_review_id uuid,
  target_decision public.clinical_review_decision,
  target_recommendation text
)
returns public.clinical_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.clinical_reviews;
  updated public.clinical_reviews;
  mar public.medication_access_requests;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.has_organization_role(
    target_organization_id, array['pharmacist']::public.member_role[]
  ) then
    raise exception 'Only a licensed pharmacist may decide a clinical review';
  end if;
  if target_decision = 'pending' then
    raise exception 'A decision must be approved, rejected, or needs_information';
  end if;

  select * into existing from public.clinical_reviews
  where id = target_review_id and organization_id = target_organization_id;
  if not found then
    raise exception 'Clinical review not found';
  end if;

  if existing.decision <> 'pending' then
    if existing.decision = target_decision
       and existing.reviewed_by = target_actor_id
       and existing.recommendation is not distinct from target_recommendation then
      return existing;
    end if;
    raise exception 'Clinical review has already been decided';
  end if;

  -- The `and decision = 'pending'` guard is load-bearing, not redundant
  -- with the check above: two concurrent callers can both read `pending`
  -- before either commits. Without this predicate in the UPDATE itself,
  -- the second transaction's unconditional UPDATE would silently
  -- overwrite the first pharmacist's decision. With it, only one of the
  -- two UPDATEs matches a row; the loser re-checks below exactly like the
  -- idempotent-replay path above.
  update public.clinical_reviews
  set decision = target_decision,
      recommendation = target_recommendation,
      reviewed_by = target_actor_id,
      reviewed_at = now(),
      updated_at = now()
  where id = target_review_id and organization_id = target_organization_id
    and decision = 'pending'
  returning * into updated;

  if not found then
    select * into existing from public.clinical_reviews
    where id = target_review_id and organization_id = target_organization_id;
    if existing.decision = target_decision
       and existing.reviewed_by = target_actor_id
       and existing.recommendation is not distinct from target_recommendation then
      return existing;
    end if;
    raise exception 'Clinical review has already been decided';
  end if;

  -- Advance the MAR only on approval, only from 'validated' (the one
  -- legal predecessor of 'reviewed'), and only if it hasn't already
  -- advanced -- an idempotent replay of an approval must not re-raise on
  -- a MAR that a prior call already moved to 'reviewed'.
  if updated.decision = 'approved' then
    select * into mar from public.medication_access_requests
    where id = updated.mar_id and organization_id = target_organization_id;
    if found and mar.state = 'validated' then
      update public.medication_access_requests
      set state = 'reviewed', transition_idempotency_key = target_idempotency_key
      where id = mar.id and organization_id = target_organization_id;
    elsif found and mar.state <> 'reviewed' and mar.state <> 'cancelled' then
      raise exception 'Medication access request is not in a state this approval can advance';
    end if;
  end if;

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'clinical.reviews.decide',
    'success', target_correlation_id, target_request_id, target_idempotency_key,
    'clinical_review', updated.id::text, null,
    jsonb_build_object('decision', updated.decision),
    null, null, target_channel, 'clinical_review.decided',
    jsonb_build_object('reviewId', updated.id, 'marId', updated.mar_id)
  );

  return updated;
end;
$$;

revoke all on function public.decide_clinical_review(
  uuid, uuid, text, text, text, text, uuid, public.clinical_review_decision, text
) from public;
grant execute on function public.decide_clinical_review(
  uuid, uuid, text, text, text, text, uuid, public.clinical_review_decision, text
) to authenticated;

comment on function public.decide_clinical_review is
  'Atomic Wave 3 use case: commits a pharmacist''s clinical review decision, advances the associated MAR from validated to reviewed on approval, and commits runtime evidence, all in one transaction. Idempotent replay is keyed on the decision itself, not a client-supplied idempotency key, since clinical_reviews has no per-decision key column.';
