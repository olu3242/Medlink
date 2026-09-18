-- Authorization convergence repair, item 6: clinical review self-review
-- guard, mirroring decide_partner_application's existing self-review
-- prohibition (202608180068_partner_engine.sql). decide_clinical_review is
-- an independent clinical approval boundary -- deciding approve/reject/
-- needs_information on someone else's submitted request -- and previously
-- had no guard against the deciding pharmacist being the same person who
-- created the underlying medication access request (organization_memberships
-- and has_organization_role already restrict who may decide at all; this
-- adds who may not decide their own).
--
-- medication_access_requests.created_by identifies the request's creator;
-- clinical_reviews has no submitter column of its own but is uniquely tied
-- to one MAR via mar_id, so that MAR's created_by is the correct identity
-- to compare the deciding actor against.
--
-- Rebased on 202607290019_mar_reviewed_on_approval.sql (the latest prior
-- redefinition of this function, not the original 202607290017) --
-- an earlier version of this migration was mistakenly based on 17 and
-- silently dropped 19's MAR-state-advancement (validated -> reviewed on
-- approval) and its concurrency-safe `and decision = 'pending'` UPDATE
-- guard + not-found fallback re-check. That regression was caught via
-- packages/e2e/tests/golden-loop.spec.ts's medication-golden-loop-e2e CI
-- job: a pharmacist's approval was recorded on clinical_reviews but the
-- linked MAR never advanced to 'reviewed', so the patient's own MAR page
-- never reflected it. Every line below 19's own logic is preserved
-- unchanged except the two self-review-guard additions.

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
  request_creator uuid;
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

  -- The deciding pharmacist must not be the creator of the underlying
  -- medication access request (self-review prohibited).
  select created_by into request_creator from public.medication_access_requests
  where id = existing.mar_id and organization_id = target_organization_id;
  if request_creator is not null and request_creator = target_actor_id then
    raise exception 'Self-review is prohibited';
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
  'Atomic Wave 3 use case: commits a pharmacist''s clinical review decision, advances the associated MAR from validated to reviewed on approval, and commits runtime evidence, all in one transaction. Idempotent replay is keyed on the decision itself, not a client-supplied idempotency key, since clinical_reviews has no per-decision key column. The deciding pharmacist must not be the creator of the underlying medication access request (self-review prohibited).';
