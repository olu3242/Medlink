-- Expose public contact/location details only for pharmacies returned by the
-- existing patient-role, consent, participation and stock eligibility boundary.
create or replace function public.discover_catalogue_inventory(
  target_patient_organization_id uuid,
  target_medicine_id uuid,
  target_latitude numeric,
  target_longitude numeric,
  target_radius_km numeric,
  target_quantity integer,
  target_consent_id uuid
)
returns setof jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(discovery) || jsonb_build_object(
    'pharmacy_phone', location.phone,
    'pharmacy_latitude', location.latitude,
    'pharmacy_longitude', location.longitude
  )
  from public.discover_marketplace_inventory(
    target_patient_organization_id, target_medicine_id,
    target_latitude, target_longitude, target_radius_km,
    target_quantity, target_consent_id
  ) discovery
  join public.pharmacy_locations location
    on location.id = discovery.pharmacy_location_id
  where location.country_code = 'NG';
$$;

revoke all on function public.discover_catalogue_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid) from public, anon;
grant execute on function public.discover_catalogue_inventory(uuid,uuid,numeric,numeric,numeric,integer,uuid) to authenticated;
