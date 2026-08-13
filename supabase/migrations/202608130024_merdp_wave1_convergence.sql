-- Compose the existing MERDP evidence tables with MedLink's canonical masters.
create extension if not exists "uuid-ossp" with schema extensions;

-- RC2's generic master originally constrained display names to 2..200
-- characters. Greenbook ingredient evidence accepted by medicines is 1..300,
-- so keep both canonical masters on the same source-fidelity boundary.
alter table public.generics drop constraint generics_canonical_name_check;
alter table public.generics add constraint generics_canonical_name_check
  check (char_length(canonical_name) between 1 and 300);
alter table public.generics drop constraint generics_normalized_name_check;
alter table public.generics add constraint generics_normalized_name_check
  check (char_length(normalized_name) between 1 and 300);

-- Compatibility wrapper for existing governed commands authored against the
-- public pgcrypto schema before Supabase installed pgcrypto in extensions.
create or replace function public.digest(value bytea, algorithm text)
returns bytea language sql immutable strict set search_path='' as $$
  select extensions.digest(value, algorithm);
$$;
revoke all on function public.digest(bytea,text) from public;
grant execute on function public.digest(bytea,text) to authenticated,service_role;

alter table public.merdp_review_cases
  add column source_record_id uuid references public.etl_source_records(id),
  add column quality_finding_id uuid references public.merdp_quality_findings(id),
  add constraint merdp_review_case_evidence_unique unique (quality_finding_id);

create unique index merdp_provenance_product_attribute_source_unique
  on public.merdp_provenance(canonical_product_id, attribute_name, winning_source_record_id)
  where canonical_product_id is not null;
create unique index merdp_provenance_organization_attribute_source_unique
  on public.merdp_provenance(canonical_organization_id, attribute_name, winning_source_record_id)
  where canonical_organization_id is not null;
create view public.merdp_latest_product_source_records as
select distinct on (r.source_record_id) r.*
from public.etl_source_records r
join public.etl_sources s on s.id = r.source_id
join public.etl_snapshots sn on sn.id = r.snapshot_id
where s.source_code = 'NAFDAC_GREENBOOK'
order by r.source_record_id, sn.received_at desc, r.created_at desc;

create view public.merdp_latest_manufacturer_source_records as
select distinct on (r.source_record_id) r.*
from public.etl_source_records r
join public.etl_sources s on s.id = r.source_id
join public.etl_snapshots sn on sn.id = r.snapshot_id
where s.source_code = 'NAFDAC_GREENBOOK_MANUFACTURERS'
order by r.source_record_id, sn.received_at desc, r.created_at desc;

create or replace function public.run_merdp_wave1_convergence(failure_stage text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  started_at timestamptz := clock_timestamp();
  system_organization_id uuid;
  result jsonb;
begin
  insert into public.organizations(name, slug, type)
  values ('MedLink Regulatory Catalog', 'medlink-regulatory-catalog', 'government')
  on conflict (slug) do update set name = excluded.name
  returning id into system_organization_id;

  insert into public.merdp_quality_findings(
    run_id, source_record_id, rule_code, field_name, raw_value, severity, message
  )
  select r.run_id, r.id, 'MANUFACTURER_REFERENCE_UNRESOLVED',
    'manufacturer_id', r.raw_payload->>'manufacturer_id', 'warning',
    'Product manufacturer source identity is absent from the manufacturer directory'
  from public.merdp_latest_product_source_records r
  where true
    and nullif(r.raw_payload->>'manufacturer_id','') is not null
    and not exists (
      select 1 from public.merdp_latest_manufacturer_source_records mr
      where mr.source_record_id = r.raw_payload->>'manufacturer_id')
  on conflict (run_id, source_record_id, rule_code, field_name) do nothing;

  -- Every quarantine finding becomes an explicit, unresolved review case.
  insert into public.merdp_review_cases(
    source_record_id, quality_finding_id, reason_code, status, evidence
  )
  select f.source_record_id, f.id, f.rule_code, 'open',
    jsonb_build_object('severity', f.severity, 'message', f.message,
      'runId', f.run_id, 'field', f.field_name)
  from public.merdp_quality_findings f
  where (f.severity in ('quarantine', 'reject')
      or f.rule_code = 'MANUFACTURER_REFERENCE_UNRESOLVED')
    and f.source_record_id is not null
  on conflict (quality_finding_id) do nothing;

  -- Manufacturer source identities remain distinct, including equal names.
  insert into public.organizations(name, slug, type, branding)
  select r.raw_payload->>'manufacturer_name',
    'nafdac-manufacturer-' || lower(r.source_record_id), 'manufacturer',
    jsonb_build_object('source', 'NAFDAC Greenbook',
      'sourceManufacturerId', r.source_record_id)
  from public.merdp_latest_manufacturer_source_records r
  where true
    and nullif(btrim(r.raw_payload->>'manufacturer_name'), '') is not null
  on conflict (slug) do update set name = excluded.name
    where organizations.name is distinct from excluded.name;

  insert into public.merdp_manufacturer_source_links(
    source_record_id, source_manufacturer_id, canonical_organization_id,
    resolution, evidence
  )
  select r.id, r.source_record_id, o.id, 'distinct',
    jsonb_build_object('method', 'source-identity-v1',
      'nameNotPrimaryKey', true, 'sourceName', r.raw_payload->>'manufacturer_name')
  from public.merdp_latest_manufacturer_source_records r
  join public.organizations o on o.slug = 'nafdac-manufacturer-' || lower(r.source_record_id)
  where true
  on conflict (source_record_id, source_manufacturer_id) do nothing;

  insert into public.merdp_provenance(
    canonical_organization_id, attribute_name, winning_value,
    winning_source_record_id, rule_version, candidate_values
  )
  select l.canonical_organization_id, 'name', to_jsonb(r.raw_payload->>'manufacturer_name'),
    r.id, 'manufacturer-source-identity-v1', '[]'::jsonb
  from public.merdp_manufacturer_source_links l
  join public.etl_source_records r on r.id = l.source_record_id
  where l.canonical_organization_id is not null
    and not exists (
      select 1 from public.merdp_provenance existing
      where existing.canonical_organization_id=l.canonical_organization_id
        and existing.attribute_name='name'
        and existing.winning_source_record_id=r.id)
  on conflict do nothing;

  insert into public.medicine_dosage_forms(code, display_name)
  select 'nafdac-form-' || coalesce(nullif(r.raw_payload->>'form_id',''), 'unspecified'),
    left(coalesce(nullif(btrim(r.raw_payload->>'form_name'), ''),
      nullif(btrim(r.raw_payload->>'form'), ''), 'Unspecified form'), 120)
  from public.merdp_latest_product_source_records r
  where true
  group by coalesce(nullif(r.raw_payload->>'form_id',''), 'unspecified'),
    coalesce(nullif(btrim(r.raw_payload->>'form_name'), ''),
      nullif(btrim(r.raw_payload->>'form'), ''), 'Unspecified form')
  on conflict (code) do update set display_name = excluded.display_name;

  -- One source product identity maps deterministically to one canonical UUID.
  -- NRN is deliberately excluded from identity construction.
  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display,
    pack_size, manufacturer_name, status
  )
  select extensions.uuid_generate_v5(
      '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'NAFDAC_GREENBOOK:' || r.source_record_id),
    left(coalesce(nullif(btrim(r.raw_payload->>'product_name'), ''),
      'NAFDAC product ' || r.source_record_id), 200),
    left(coalesce(nullif(btrim(r.raw_payload->>'ingredient_name'), ''),
      nullif(btrim(r.raw_payload->>'ingredient'), ''), 'Unspecified ingredient'), 300),
    'nafdac-form-' || coalesce(nullif(r.raw_payload->>'form_id',''), 'unspecified'),
    left(coalesce(nullif(btrim(r.raw_payload->>'route_name'), ''),
      nullif(btrim(r.raw_payload->>'route'), ''), 'Unspecified route'), 100),
    left(coalesce(nullif(btrim(r.raw_payload->>'strength'), ''), 'Unspecified'), 100),
    nullif(btrim(r.raw_payload->>'pack_size'), ''),
    (select mr.raw_payload->>'manufacturer_name'
      from public.merdp_latest_manufacturer_source_records mr
      where mr.source_record_id = r.raw_payload->>'manufacturer_id'
      limit 1), 'draft'
  from public.merdp_latest_product_source_records r
  where true
    and not exists (select 1 from public.merdp_quality_findings f
      where f.source_record_id = r.id and f.severity in ('quarantine','reject'))
  on conflict (id) do update set
    brand_name=excluded.brand_name, generic_name=excluded.generic_name,
    dosage_form=excluded.dosage_form, route=excluded.route,
    strength_display=excluded.strength_display, pack_size=excluded.pack_size,
    manufacturer_name=excluded.manufacturer_name, updated_at=now()
  where (medicines.brand_name,medicines.generic_name,medicines.dosage_form,
    medicines.route,medicines.strength_display,medicines.pack_size,
    medicines.manufacturer_name) is distinct from
    (excluded.brand_name,excluded.generic_name,excluded.dosage_form,
    excluded.route,excluded.strength_display,excluded.pack_size,
    excluded.manufacturer_name);

  insert into public.merdp_source_mappings(
    source_record_id, canonical_product_id, canonical_organization_id, regulatory_identifier,
    resolution, evidence
  )
  select r.id,
    extensions.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'NAFDAC_GREENBOOK:' || r.source_record_id),
    o.id,
    nullif(btrim(r.raw_payload->>'NAFDAC'), ''), 'distinct',
    jsonb_build_object('method', 'source-product-identity-v1',
      'nrnIsCanonicalKey', false, 'sourceProductId', r.source_record_id)
  from public.merdp_latest_product_source_records r
  left join public.organizations o
    on o.slug = 'nafdac-manufacturer-' || lower(r.raw_payload->>'manufacturer_id')
  where true
    and not exists (select 1 from public.merdp_quality_findings f
      where f.source_record_id = r.id and f.severity in ('quarantine','reject'))
  on conflict (source_record_id) do nothing;

  if failure_stage = 'after_mappings' then
    raise exception 'MERDP_CONTROLLED_FAILURE_AFTER_MAPPINGS';
  end if;

  -- The legacy registration table has a global uniqueness constraint. Only
  -- non-colliding NRNs enter that index; collision groups remain in mapping
  -- evidence and cannot drive an automatic merge.
  with registrations as (
    select m.canonical_product_id, m.regulatory_identifier,
      min(nullif(r.raw_payload->>'approval_date','')::date) as valid_from,
      min(nullif(r.raw_payload->>'expiry_date','')::date) as valid_until,
      count(*) over (partition by m.regulatory_identifier) as nrn_count
    from public.merdp_source_mappings m
    join public.etl_source_records r on r.id = m.source_record_id
    where m.canonical_product_id is not null and m.regulatory_identifier is not null
    group by m.canonical_product_id, m.regulatory_identifier
  )
  insert into public.medicine_registrations(
    medicine_id, country_code, authority_code, registration_number,
    valid_from, valid_until, metadata
  )
  select canonical_product_id, 'NG', 'NAFDAC', regulatory_identifier,
    valid_from, case when valid_until >= valid_from or valid_from is null
      then valid_until else null end,
    jsonb_build_object('source', 'NAFDAC Greenbook', 'collisionCount', nrn_count)
  from registrations where nrn_count = 1
  on conflict (country_code, authority_code, registration_number) do nothing;

  -- Preserve ingredient identities and combinations using source ingredient IDs.
  with ingredient_sources as (
    select r.raw_payload->>'ingredient_id' as source_id,
      min(coalesce(nullif(btrim(r.raw_payload->>'ingredient_name'), ''),
        nullif(btrim(r.raw_payload->>'ingredient'), ''),
        'NAFDAC ingredient ' || (r.raw_payload->>'ingredient_id'))) as source_name
    from public.merdp_latest_product_source_records r
    where true
      and nullif(r.raw_payload->>'ingredient_id', '') is not null
    group by r.raw_payload->>'ingredient_id'
  ), named as (
    select i.*, count(*) over (partition by lower(i.source_name)) as name_count
    from ingredient_sources i
  )
  insert into public.active_ingredients(id, preferred_name, description)
  select extensions.uuid_generate_v5(
      '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'NAFDAC_INGREDIENT:' || source_id),
    left(source_name || case when name_count > 1
      then ' [NAFDAC ' || source_id || ']' else '' end, 200),
    'NAFDAC Greenbook source ingredient identity'
  from named
  on conflict (id) do nothing;

  insert into public.medicine_ingredients(medicine_id, active_ingredient_id, is_primary)
  select m.canonical_product_id,
    extensions.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'NAFDAC_INGREDIENT:' || (r.raw_payload->>'ingredient_id')), true
  from public.merdp_latest_product_source_records r
  join public.merdp_source_mappings m on m.source_record_id = r.id
  where m.canonical_product_id is not null
    and nullif(r.raw_payload->>'ingredient_id', '') is not null
  on conflict do nothing;

  insert into public.merdp_provenance(
    canonical_product_id, attribute_name, winning_value,
    winning_source_record_id, rule_version, candidate_values
  )
  select m.canonical_product_id, v.attribute_name, v.winning_value,
    r.id, 'greenbook-materialization-v1', '[]'::jsonb
  from public.merdp_latest_product_source_records r
  join public.merdp_source_mappings m on m.source_record_id = r.id
  cross join lateral (values
    ('brand_name', to_jsonb(r.raw_payload->>'product_name')),
    ('ingredient', to_jsonb(r.raw_payload->>'ingredient_name')),
    ('strength', to_jsonb(r.raw_payload->>'strength')),
    ('form', to_jsonb(r.raw_payload->>'form_name')),
    ('route', to_jsonb(r.raw_payload->>'route_name')),
    ('regulatory_identifier', to_jsonb(r.raw_payload->>'NAFDAC')),
    ('category', to_jsonb(r.raw_payload->>'category_name')),
    ('status', to_jsonb(r.raw_payload->>'status')),
    ('expiry', to_jsonb(r.raw_payload->>'expiry_date')),
    ('source_manufacturer_id', to_jsonb(r.raw_payload->>'manufacturer_id'))
  ) v(attribute_name, winning_value)
  where m.canonical_product_id is not null
    and not exists (
      select 1 from public.merdp_provenance existing
      where existing.canonical_product_id=m.canonical_product_id
        and existing.attribute_name=v.attribute_name
        and existing.winning_source_record_id=r.id)
  on conflict do nothing;

  -- Certification is independent from source validity. Only current active
  -- human medicines with complete lineage qualify for ordinary publication.
  update public.merdp_certifications c set status='revoked',
    evidence=c.evidence || jsonb_build_object('reevaluatedAt',now(),'reason','latest-source-ineligible')
  from public.merdp_source_mappings m
  join public.merdp_latest_product_source_records r on r.id=m.source_record_id
  where c.canonical_product_id=m.canonical_product_id
    and c.policy_version='wave1-human-medicine-v1'
    and not (r.raw_payload->>'category_name' in ('Drugs','Vaccines and Biologics')
      and lower(coalesce(r.raw_payload->>'status',''))='active'
      and nullif(r.raw_payload->>'expiry_date','')::date >= current_date);

  insert into public.merdp_certifications(
    canonical_product_id, status, policy_version, evidence, certified_at
  )
  select m.canonical_product_id, 'certified', 'wave1-human-medicine-v1',
    jsonb_build_object('sourceRecordId', r.id, 'category', r.raw_payload->>'category_name',
      'sourceStatus', r.raw_payload->>'status', 'expiry', r.raw_payload->>'expiry_date'), now()
  from public.merdp_latest_product_source_records r
  join public.merdp_source_mappings m on m.source_record_id = r.id
  where r.raw_payload->>'category_name' in ('Drugs','Vaccines and Biologics')
    and lower(coalesce(r.raw_payload->>'status','')) = 'active'
    and nullif(r.raw_payload->>'expiry_date','')::date >= current_date
    and (select count(*) from public.merdp_provenance p
      where p.canonical_product_id = m.canonical_product_id) >= 10
  on conflict (canonical_product_id, policy_version) do update set
    status='certified', evidence=excluded.evidence, certified_at=excluded.certified_at
  where (merdp_certifications.status,merdp_certifications.evidence)
    is distinct from (excluded.status,excluded.evidence);

  insert into public.merdp_publications(
    canonical_product_id, certification_id, version, projection, provenance_manifest
  )
  select c.canonical_product_id, c.id, coalesce(lastp.version,0)+1,
    projection.value,
    jsonb_build_object('sourceRecordId', m.source_record_id,
      'provenanceCount', (select count(*) from public.merdp_provenance p
        where p.canonical_product_id = c.canonical_product_id))
  from public.merdp_certifications c
  join public.medicines med on med.id = c.canonical_product_id
  join public.merdp_latest_product_source_records r on true
  join public.merdp_source_mappings m on m.source_record_id=r.id
    and m.canonical_product_id=c.canonical_product_id
  cross join lateral (select jsonb_build_object('medicineId', med.id, 'brandName', med.brand_name,
      'genericName', med.generic_name, 'strength', med.strength_display,
      'form', med.dosage_form, 'route', med.route,
      'registrationNumber', m.regulatory_identifier) value) projection
  left join lateral (select p.version,p.projection from public.merdp_publications p
    where p.canonical_product_id=c.canonical_product_id order by p.version desc limit 1) lastp on true
  where c.status = 'certified' and lastp.projection is distinct from projection.value
  on conflict (canonical_product_id, version) do nothing;

  update public.medicines med set status = 'active'
  where exists (select 1 from public.merdp_publications p
    where p.canonical_product_id = med.id) and med.status <> 'active';

  update public.medicines med set status='draft'
  where exists(select 1 from public.merdp_source_mappings m where m.canonical_product_id=med.id)
    and not exists(select 1 from public.merdp_certifications c
      where c.canonical_product_id=med.id and c.status='certified')
    and med.status <> 'draft';

  insert into public.runtime_outbox_events(
    organization_id, event_type, aggregate_type, aggregate_id, payload,
    correlation_id, request_id, idempotency_key
  )
  select system_organization_id, 'merdp.medicine-published.v1', 'medicine',
    p.canonical_product_id::text,
    jsonb_build_object('publicationId', p.id, 'medicineId', p.canonical_product_id,
      'version', p.version),
    'merdp-wave1', 'merdp-wave1', 'merdp-publication:' || p.id
  from public.merdp_publications p
  on conflict (organization_id, idempotency_key) do nothing;

  select jsonb_build_object(
    'durationMs', extract(epoch from clock_timestamp() - started_at) * 1000,
    'reviewCases', (select count(*) from public.merdp_review_cases),
    'productMappings', (select count(*) from public.merdp_source_mappings where canonical_product_id is not null),
    'manufacturerMappings', (select count(*) from public.merdp_manufacturer_source_links where canonical_organization_id is not null),
    'provenance', (select count(*) from public.merdp_provenance),
    'certifications', (select count(*) from public.merdp_certifications where status='certified'),
    'publications', (select count(*) from public.merdp_publications),
    'events', (select count(*) from public.runtime_outbox_events where event_type='merdp.medicine-published.v1')
  ) into result;
  return result;
end;
$$;

revoke all on function public.run_merdp_wave1_convergence(text) from public;
grant execute on function public.run_merdp_wave1_convergence(text) to service_role;

create or replace function public.merdp_wave1_state()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'medicines',(select count(*) from public.medicines),
    'organizations',(select count(*) from public.organizations),
    'productMappings',(select count(*) from public.merdp_source_mappings),
    'manufacturerMappings',(select count(*) from public.merdp_manufacturer_source_links),
    'reviewCases',(select count(*) from public.merdp_review_cases),
    'provenance',(select count(*) from public.merdp_provenance),
    'certifications',(select count(*) from public.merdp_certifications),
    'publications',(select count(*) from public.merdp_publications),
    'events',(select count(*) from public.runtime_outbox_events)
  );
$$;
revoke all on function public.merdp_wave1_state() from public;
grant execute on function public.merdp_wave1_state() to service_role;

create or replace function public.merdp_exit_fixture_state(
  product_source_id text, manufacturer_source_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  with product_mapping as (
    select m.canonical_product_id from public.merdp_source_mappings m
    join public.merdp_latest_product_source_records r on r.id=m.source_record_id
    where r.source_record_id=product_source_id limit 1
  ), manufacturer_mapping as (
    select l.canonical_organization_id from public.merdp_manufacturer_source_links l
    join public.merdp_latest_manufacturer_source_records r on r.id=l.source_record_id
    where r.source_record_id=manufacturer_source_id limit 1
  ) select jsonb_build_object(
    'medicineId',(select canonical_product_id from product_mapping),
    'medicineStatus',(select status from public.medicines where id=(select canonical_product_id from product_mapping)),
    'strength',(select strength_display from public.medicines where id=(select canonical_product_id from product_mapping)),
    'productEvidence',(select count(*) from public.etl_source_records where source_record_id=product_source_id),
    'provenance',(select count(*) from public.merdp_provenance where canonical_product_id=(select canonical_product_id from product_mapping)),
    'certification',(select status from public.merdp_certifications where canonical_product_id=(select canonical_product_id from product_mapping) and policy_version='wave1-human-medicine-v1'),
    'publicationVersions',(select count(*) from public.merdp_publications where canonical_product_id=(select canonical_product_id from product_mapping)),
    'publicationEvents',(select count(*) from public.runtime_outbox_events where aggregate_id=(select canonical_product_id from product_mapping)::text and event_type='merdp.medicine-published.v1'),
    'organizationId',(select canonical_organization_id from manufacturer_mapping),
    'organizationName',(select name from public.organizations where id=(select canonical_organization_id from manufacturer_mapping)),
    'manufacturerEvidence',(select count(*) from public.etl_source_records where source_record_id=manufacturer_source_id)
  );
$$;
revoke all on function public.merdp_exit_fixture_state(text,text) from public;
grant execute on function public.merdp_exit_fixture_state(text,text) to service_role;
