-- Wave 3: atomic, idempotent-replay-safe clinical review decision.
--
-- apps/patient/lib/application.ts's AccessApplication.decideReview() has
-- always been a raw two-step update: `.eq("decision", "pending")` as an
-- optimistic-concurrency guard, no runtime evidence commit -- the other
-- half of the S01.8 gap docs/audit/RC1_BACKLOG.md's item 3 named
-- (`create_mar`, migration 202607290016, closed the MAR half). It also has
-- a distinct bug the audit found: because the guard matches zero rows once
-- a review is no longer pending, a repeated call with the *same* decision
-- (a client retry after a dropped response, for instance) doesn't replay
-- safely -- it errors, since `.single()` requires exactly one matched row.
--
-- clinical_reviews has no idempotency-key column of its own to key a
-- replay check on (its existing `idempotency_key` dedups *creation*, and
-- review creation has no route yet -- reviews are seeded some other way
-- this migration doesn't change). The review is already uniquely
-- identified by id, so this treats the decision itself as the idempotency
-- signal: the same actor re-submitting the same decision on an
-- already-decided review returns the existing row; a different decision,
-- or a different actor, targeting an already-decided review is a real
-- conflict and still raises.

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
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  -- Mirrors the clinical_reviews_pharmacist_manage RLS policy: only a
  -- licensed pharmacist may decide a clinical review.
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

  update public.clinical_reviews
  set decision = target_decision,
      recommendation = target_recommendation,
      reviewed_by = target_actor_id,
      reviewed_at = now(),
      updated_at = now()
  where id = target_review_id and organization_id = target_organization_id
  returning * into updated;

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
  'Atomic Wave 3 use case: commits a pharmacist''s clinical review decision and its runtime evidence in one transaction. Idempotent replay is keyed on the decision itself (same actor, same decision, same recommendation on an already-decided review), not a client-supplied idempotency key, since clinical_reviews has no per-decision key column.';
