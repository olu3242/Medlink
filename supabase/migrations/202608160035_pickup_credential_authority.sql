-- Pickup credential authority correction (post PR#26/#27 policy decision):
-- the pharmacy must never generate or possess the plaintext pickup
-- credential before the patient presents it back. Readiness (the pharmacy
-- has prepared the medication) and credential issuance (the patient
-- proves who they are at pickup) are separate concerns with independent
-- lifecycles:
--
--   reservation:  confirmed -> ready -> collected
--   credential:   none -> issued (hash stored / plaintext shown once
--                 client-side, never sent to any server) -> consumed
--
-- mark_reservation_ready no longer accepts or stores a credential hash at
-- all -- it only performs the confirmed->ready transition. Only the
-- authenticated patient who owns the reservation may issue a credential
-- for it, and only once it is 'ready'. collect_reservation is completely
-- unchanged: it already requires reservations.pickup_code_hash to match
-- the presented hash, which is null (and so never matches) until
-- issue_pickup_credential sets it -- "collection requires a valid issued
-- credential" was already an emergent property of that existing check,
-- not something that needed new logic.

drop function if exists public.mark_reservation_ready(
  uuid, uuid, text, text, text, text, uuid, text
);

create or replace function public.mark_reservation_ready(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reservation public.reservations;
  prior_transition public.fulfillment_transitions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if not public.is_organization_member(target_organization_id) or not public.has_organization_role(
    target_organization_id,
    array['pharmacist', 'pharmacy_staff']::public.member_role[]
  ) then
    raise exception 'Marking a reservation ready requires pharmacy staff or pharmacist role';
  end if;

  select * into prior_transition from public.fulfillment_transitions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if prior_transition.reservation_id <> target_reservation_id
       or prior_transition.to_state <> 'ready' then
      raise exception 'Idempotency key was already used for a different reservation decision';
    end if;
    select * into current_reservation from public.reservations
    where id = target_reservation_id and organization_id = target_organization_id;
    -- Stripped even on this replay path: by the time of a replay the
    -- patient may have already issued a credential via
    -- issue_pickup_credential, so this row can carry a real hash now even
    -- though this function never wrote one.
    return to_jsonb(current_reservation) - 'pickup_code_hash';
  end if;

  select * into current_reservation from public.reservations
  where id = target_reservation_id and organization_id = target_organization_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.status <> 'confirmed' then
    raise exception 'Only a confirmed reservation may be marked ready';
  end if;

  update public.reservations set status = 'ready'
  where id = target_reservation_id and organization_id = target_organization_id
  returning * into current_reservation;

  insert into public.fulfillment_transitions (
    organization_id, reservation_id, from_state, to_state, step, idempotency_key, correlation_id
  ) values (
    target_organization_id, target_reservation_id, 'confirmed', 'ready', 'pharmacy.ready',
    target_idempotency_key, target_correlation_id::uuid
  );

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.ready', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', target_reservation_id::text,
    jsonb_build_object('status', 'confirmed'), jsonb_build_object('status', 'ready'),
    null, null, target_channel, 'reservation.ready.v1',
    jsonb_build_object('tenantId', target_organization_id, 'reservationId', target_reservation_id)
  );
  return to_jsonb(current_reservation) - 'pickup_code_hash';
end;
$$;

revoke all on function public.mark_reservation_ready(
  uuid, uuid, text, text, text, text, uuid
) from public;
grant execute on function public.mark_reservation_ready(
  uuid, uuid, text, text, text, text, uuid
) to authenticated;

comment on function public.mark_reservation_ready is
  'Transitions a confirmed reservation to ready. Carries no pickup credential -- issuance is a separate, patient-owned action (issue_pickup_credential).';

-- Patient-owned, client-generated credential issuance. The plaintext
-- pickup code is generated and hashed entirely in the patient's browser
-- (Web Crypto: crypto.getRandomValues + crypto.subtle.digest, see
-- apps/patient/lib/pickup-credential.ts) -- this function, like
-- collect_reservation, only ever receives/stores/compares the SHA-256
-- hash, and strips pickup_code_hash from its own return value (jsonb, not
-- the raw composite type) the same way mark_reservation_ready/
-- collect_reservation already do -- the hash itself must never be echoed
-- back to any client, only its presence/absence.
create or replace function public.issue_pickup_credential(
  target_organization_id uuid,
  target_actor_id uuid,
  target_correlation_id text,
  target_request_id text,
  target_idempotency_key text,
  target_channel text,
  target_reservation_id uuid,
  target_pickup_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reservation public.reservations;
  prior_transition public.fulfillment_transitions;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid() then
    raise exception 'Authenticated actor mismatch';
  end if;
  if target_pickup_code_hash is null or char_length(target_pickup_code_hash) <> 64 then
    raise exception 'A valid pickup credential hash is required';
  end if;

  select * into current_reservation from public.reservations
  where id = target_reservation_id and organization_id = target_organization_id
  for update;
  if not found then raise exception 'Reservation not found'; end if;
  if current_reservation.patient_id is distinct from target_actor_id then
    raise exception 'Only the reservation''s own patient may issue a pickup credential';
  end if;
  if current_reservation.status <> 'ready' then
    raise exception 'A pickup credential may only be issued once a reservation is ready';
  end if;

  -- Idempotent replay: same key, same hash -> success, no-op, no rotation.
  -- Same key against a different reservation/step, or a hash that
  -- disagrees with what this key already issued -> reject. A credential
  -- already issued under a *different* idempotency key is a rotation/reset
  -- attempt with no defined policy yet (see the migration file header) and
  -- is rejected the same way, not silently allowed.
  select * into prior_transition from public.fulfillment_transitions
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if prior_transition.reservation_id <> target_reservation_id
       or prior_transition.step <> 'patient.credential_issued' then
      raise exception 'Idempotency key was already used for a different reservation decision';
    end if;
    if current_reservation.pickup_code_hash is distinct from target_pickup_code_hash then
      raise exception 'Idempotency key was already used to issue a different pickup credential';
    end if;
    return to_jsonb(current_reservation) - 'pickup_code_hash';
  end if;

  if current_reservation.pickup_code_hash is not null then
    raise exception 'A pickup credential has already been issued for this reservation';
  end if;

  update public.reservations set pickup_code_hash = target_pickup_code_hash
  where id = target_reservation_id and organization_id = target_organization_id
  returning * into current_reservation;

  insert into public.fulfillment_transitions (
    organization_id, reservation_id, from_state, to_state, step, idempotency_key, correlation_id
  ) values (
    target_organization_id, target_reservation_id, 'ready', 'ready', 'patient.credential_issued',
    target_idempotency_key, target_correlation_id::uuid
  );

  perform public.record_runtime_evidence(
    target_organization_id, target_actor_id, 'reservations.issue_credential', 'success',
    target_correlation_id, target_request_id, target_idempotency_key,
    'reservation', target_reservation_id::text,
    jsonb_build_object('pickupCredentialIssued', false),
    jsonb_build_object('pickupCredentialIssued', true),
    null, null, target_channel, 'reservation.credential_issued.v1',
    jsonb_build_object('tenantId', target_organization_id, 'reservationId', target_reservation_id)
  );
  return to_jsonb(current_reservation) - 'pickup_code_hash';
end;
$$;

revoke all on function public.issue_pickup_credential(
  uuid, uuid, text, text, text, text, uuid, text
) from public;
grant execute on function public.issue_pickup_credential(
  uuid, uuid, text, text, text, text, uuid, text
) to authenticated;

comment on function public.issue_pickup_credential is
  'Stores a patient-generated pickup credential hash on a ready reservation. Plaintext never reaches this function or any server -- it is generated and hashed client-side. Never rotates an existing credential; a second issuance under a new idempotency key is rejected, not silently replaced.';
