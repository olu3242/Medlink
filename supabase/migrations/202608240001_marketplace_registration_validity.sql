-- Greenbook canonical intelligence hardening, P0: discover_marketplace_inventory
-- (202608180071) currently gates candidates only on medicines.status='active'
-- and inventory-level discoverability -- medicine_registrations.valid_until
-- is stored (202607270002) but was never read by any query in the codebase
-- (confirmed by a full-repo grep during the medication-intelligence
-- certification pass). An expired or not-yet-valid NAFDAC registration could
-- not exclude a medicine from marketplace discovery. This migration adds one
-- reusable predicate and wires it into the existing candidates filter --
-- it does not introduce a second/duplicate regulatory-status source, and it
-- does not touch medicines.status, which remains the unrelated internal
-- catalog-lifecycle flag it always was.
--
-- Deterministic eligibility rule, evaluated per medicine as of current_date:
--   * ANY non-deleted medicine_registrations row for the medicine with
--     (valid_from is null or valid_from <= as_of) AND
--     (valid_until is null or valid_until >= as_of)
--     makes the medicine regulatorily eligible. A medicine can carry several
--     registration rows (e.g. renewed, or multiple authorities); only one
--     currently-valid row is required -- this is not "all must be valid".
--   * A registration row with no valid_until is treated as open-ended/valid
--     (NAFDAC Greenbook data does not guarantee an expiry field is present;
--     absence of an expiry is not evidence of expiry). This is not a "fail
--     closed" case: the row itself is real registration evidence, just
--     without a known end date.
--   * A medicine with ZERO non-deleted registration rows at all has no
--     registration evidence whatsoever -- eligibility cannot be
--     established, so this fails CLOSED (not eligible). This is the actual
--     "cannot safely be established" case the existing governance posture
--     (fail closed, e.g. reserve_inventory's active-location guard) already
--     applies elsewhere.
--   * "Malformed" evidence (valid_until before valid_from) cannot occur in
--     stored data: medicine_registrations already has
--     `check (valid_until is null or valid_from is null or valid_until >= valid_from)`
--     at the table level (202607270002), so no additional handling is
--     needed for that case here.
create or replace function public.medicine_has_valid_registration(
  target_medicine_id uuid,
  as_of date default current_date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.medicine_registrations registration
    where registration.medicine_id = target_medicine_id
      and registration.deleted_at is null
      and (registration.valid_from is null or registration.valid_from <= as_of)
      and (registration.valid_until is null or registration.valid_until >= as_of)
  );
$$;

revoke all on function public.medicine_has_valid_registration(uuid, date) from public;
grant execute on function public.medicine_has_valid_registration(uuid, date) to authenticated, service_role;

comment on function public.medicine_has_valid_registration is
  'Deterministic regulatory-eligibility predicate over the existing medicine_registrations table: true if any non-deleted registration row is currently valid as of the given date (open-ended valid_until counts as valid), false if none is valid OR no registration evidence exists at all (fails closed on missing evidence, not on missing expiry). Not a new regulatory-status source -- reads the same table medicine_registrations.valid_from/valid_until already populated by MERDP.';

-- Re-published with one added predicate in the candidates CTE (identical
-- SECURITY DEFINER boundary, consent check, geography validation, and
-- output projection to 202608180071 -- see that file's own comment for the
-- full narrow-projection rationale, unchanged here).
create or replace function public.discover_marketplace_inventory(
  target_patient_organization_id uuid,
  target_medicine_id uuid,
  target_latitude numeric,
  target_longitude numeric,
  target_radius_km numeric,
  target_quantity integer,
  target_consent_id uuid
)
returns table(
  inventory_id uuid,
  pharmacy_location_id uuid,
  pharmacy_name text,
  pharmacy_locality text,
  medicine_id uuid,
  medicine_name text,
  relationship text,
  distance_km numeric,
  availability_state text,
  unit_price_minor bigint,
  currency_code text,
  inventory_timestamp timestamptz,
  reservation_eligible boolean,
  pharmacist_review_required boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.has_organization_role(
       target_patient_organization_id,
       array['patient']::public.member_role[]
     ) then
    raise exception 'Marketplace discovery requires an authenticated patient context'
      using errcode = '42501';
  end if;
  if target_latitude is null or target_latitude not between -90 and 90
     or target_longitude is null or target_longitude not between -180 and 180
     or target_radius_km is null or target_radius_km < 1 or target_radius_km > 200
     or target_quantity is null or target_quantity < 1 or target_quantity > 1000000 then
    raise exception 'Marketplace discovery geography or quantity is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.consent_records consent
    where consent.id = target_consent_id
      and consent.organization_id = target_patient_organization_id
      and consent.subject_user_id = auth.uid()
      and consent.consent_type = 'marketplace_location_discovery'
      and consent.action = 'granted'
      and not exists (
        select 1 from public.consent_records successor
        where successor.supersedes_id = consent.id
      )
  ) then
    raise exception 'Valid location consent is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.medicines requested
    where requested.id = target_medicine_id
      and requested.status = 'active' and requested.deleted_at is null
  ) then
    raise exception 'Canonical medication is not discoverable' using errcode = '22023';
  end if;

  return query
  with requested as (
    select id, generic_id, dosage_form, strength_display
    from public.medicines
    where id = target_medicine_id
  ), candidates as (
    select
      batch.id as inventory_id,
      location.id as pharmacy_location_id,
      location.name as pharmacy_name,
      location.locality as pharmacy_locality,
      medicine.id as medicine_id,
      coalesce(nullif(medicine.brand_name, ''), medicine.generic_name) as medicine_name,
      case when medicine.id = requested.id then 'exact' else 'generic_related' end as relationship,
      round((
        6371::numeric * 2 * asin(sqrt(least(1::numeric,
          power(sin(radians((location.latitude - target_latitude)::numeric) / 2), 2)
          + cos(radians(target_latitude::numeric)) * cos(radians(location.latitude::numeric))
          * power(sin(radians((location.longitude - target_longitude)::numeric) / 2), 2)
        )))
      )::numeric, 3) as distance_km,
      public.inventory_availability_state(
        batch.status, batch.expires_on, batch.available_quantity,
        batch.quantity_reserved, batch.low_stock_threshold, location.is_active
      ) as availability_state,
      batch.unit_price_minor,
      batch.unit_price_currency_code as currency_code,
      batch.source_updated_at as inventory_timestamp,
      row_number() over (
        partition by location.id,
          case when medicine.id = requested.id then 'exact' else 'generic_related' end
        order by batch.expires_on, batch.id
      ) as candidate_rank
    from public.inventory_batches batch
    join public.pharmacy_locations location
      on location.id = batch.pharmacy_location_id
     and location.organization_id = batch.organization_id
    join public.medicines medicine on medicine.id = batch.medicine_id
    cross join requested
    where public.is_inventory_batch_discoverable(batch.id)
      and batch.available_quantity >= target_quantity
      and medicine.status = 'active' and medicine.deleted_at is null
      and public.medicine_has_valid_registration(medicine.id)
      and (
        medicine.id = requested.id
        or (
          requested.generic_id is not null
          and medicine.generic_id = requested.generic_id
          and medicine.dosage_form = requested.dosage_form
          and medicine.strength_display = requested.strength_display
          and medicine.id <> requested.id
        )
      )
  )
  select
    candidate.inventory_id,
    candidate.pharmacy_location_id,
    candidate.pharmacy_name,
    candidate.pharmacy_locality,
    candidate.medicine_id,
    candidate.medicine_name,
    candidate.relationship,
    candidate.distance_km,
    candidate.availability_state,
    candidate.unit_price_minor,
    candidate.currency_code,
    candidate.inventory_timestamp,
    candidate.relationship = 'exact',
    candidate.relationship = 'generic_related'
  from candidates candidate
  where candidate.candidate_rank = 1
    and candidate.distance_km <= target_radius_km
  order by candidate.distance_km, candidate.relationship, candidate.inventory_id;
end;
$$;

revoke all on function public.discover_marketplace_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid)
from public, anon;
grant execute on function public.discover_marketplace_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid)
to authenticated;

comment on function public.discover_marketplace_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid) is
  'Narrow cross-organization marketplace projection. Requires patient membership plus an explicit current location-consent record; returns only public location identity, canonical medication identity, distance, availability, authoritative price, freshness timestamp, and reservation eligibility. Every candidate (exact or generic_related) additionally requires public.medicine_has_valid_registration(medicine.id) -- an expired, not-yet-valid, or unregistered medicine can never appear as an exact or generic_related discovery result, regardless of inventory availability.';
