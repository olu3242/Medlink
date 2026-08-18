-- Governed cross-organization marketplace discovery. Ordinary tenant RLS
-- remains organization-scoped; this SECURITY DEFINER projection exposes only
-- the public fields required to choose and reserve eligible medication stock.

drop policy if exists pharmacy_locations_discovery_read on public.pharmacy_locations;
create policy pharmacy_locations_member_read
on public.pharmacy_locations for select to authenticated
using (public.is_organization_member(organization_id));

create or replace function public.capture_marketplace_location_consent(
  target_organization_id uuid,
  target_actor_id uuid,
  target_idempotency_key text,
  target_policy_version text default 'marketplace-location-v1'
)
returns public.consent_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  captured public.consent_records;
begin
  if auth.uid() is null or target_actor_id is distinct from auth.uid()
     or not public.has_organization_role(
       target_organization_id,
       array['patient']::public.member_role[]
     ) then
    raise exception 'Patient location consent authority is invalid' using errcode = '42501';
  end if;
  if btrim(coalesce(target_idempotency_key, '')) = ''
     or btrim(coalesce(target_policy_version, '')) = '' then
    raise exception 'Location consent context is invalid' using errcode = '22023';
  end if;

  select * into captured from public.consent_records
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    if captured.subject_user_id is distinct from target_actor_id
       or captured.consent_type <> 'marketplace_location_discovery'
       or captured.action <> 'granted'
       or captured.policy_version <> target_policy_version then
      raise exception 'Location consent idempotency conflict';
    end if;
    return captured;
  end if;

  insert into public.consent_records(
    organization_id, subject_user_id, consent_type, policy_version, action,
    lawful_basis, scope, captured_by, idempotency_key, evidence_hash
  ) values (
    target_organization_id, target_actor_id,
    'marketplace_location_discovery', target_policy_version, 'granted',
    'consent',
    jsonb_build_object(
      'purpose', 'nearby_medication_discovery',
      'coordinatesStored', false
    ),
    target_actor_id, target_idempotency_key,
    encode(public.digest(convert_to(
      target_organization_id::text || ':' || target_actor_id::text || ':' ||
      target_idempotency_key || ':' || target_policy_version,
      'UTF8'
    ), 'sha256'), 'hex')
  ) returning * into captured;
  return captured;
end;
$$;

revoke all on function public.capture_marketplace_location_consent(uuid,uuid,text,text)
from public, anon;
grant execute on function public.capture_marketplace_location_consent(uuid,uuid,text,text)
to authenticated;

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
  'Narrow cross-organization marketplace projection. Requires patient membership plus an explicit current location-consent record; returns only public location identity, canonical medication identity, distance, availability, authoritative price, freshness timestamp, and reservation eligibility.';
