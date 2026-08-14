-- Continuous NAFDAC reference-data policy. Manufacturer relationships are evidence;
-- only the authoritative product listing can establish current listing membership.
alter table public.merdp_manufacturer_product_relationships
  add column source_state text not null default 'UNRESOLVED'
    check (source_state in ('CURRENT_LISTED','OFF_LIST_SOURCE_EVIDENCE','QUARANTINED','UNRESOLVED')),
  add column evidence_classification text not null default 'UNRESOLVED'
    check (evidence_classification in ('CURRENT_SOURCE_MATCH','SOURCE_INSUFFICIENT','INSUFFICIENT_EVIDENCE','HIGH_CONFIDENCE_HISTORICAL_EQUIVALENCE','AMBIGUOUS_EQUIVALENCE','CONFLICT','UNRESOLVED')),
  add column current_listing_membership boolean not null default false,
  add column possible_canonical_product_ids jsonb not null default '[]'::jsonb,
  add column first_observed_at timestamptz not null default now(),
  add column last_observed_at timestamptz not null default now();

create index merdp_relationship_source_state_idx
  on public.merdp_manufacturer_product_relationships(source_state,evidence_classification);

create or replace function public.run_merdp_nafdac_reference_convergence(
  failure_stage text default null,
  enforce_certified_baseline boolean default true
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='0'
as $$
declare
  started_at timestamptz := clock_timestamp();
  before_medicines bigint; before_organizations bigint; before_mappings bigint;
  before_certifications bigint; before_publications bigint; before_prescriptions bigint;
  before_inventory bigint; result jsonb;
begin
  select count(*) into before_medicines from public.medicines;
  select count(*) into before_organizations from public.organizations;
  select count(*) into before_mappings from public.merdp_source_mappings;
  select count(*) into before_certifications from public.merdp_certifications;
  select count(*) into before_publications from public.merdp_publications;
  select count(*) into before_prescriptions from public.prescriptions;
  select count(*) into before_inventory from public.inventory_batches;

  if enforce_certified_baseline and (
    (select count(*) from public.merdp_manufacturer_product_relationships where product_source_id~'^[0-9]+$')<>11707 or
    (select count(*) from public.merdp_manufacturer_identities where source_manufacturer_id~'^[0-9]+$')<>1389
  ) then raise exception 'NAFDAC_REFERENCE_BASELINE_MISMATCH'; end if;

  -- Current membership comes only from an authoritative product source record.
  update public.merdp_manufacturer_product_relationships r set
    source_state=case when p.id is not null then 'CURRENT_LISTED' else 'OFF_LIST_SOURCE_EVIDENCE' end,
    current_listing_membership=p.id is not null,
    evidence_classification=case when p.id is not null then 'CURRENT_SOURCE_MATCH' else 'SOURCE_INSUFFICIENT' end,
    possible_canonical_product_ids='[]'::jsonb,
    last_observed_at=greatest(r.last_observed_at,r.created_at)
  from (select r0.id,
    (select pr.id from public.merdp_latest_product_source_records pr
      where pr.source_record_id=r0.product_source_id limit 1) product_record_id
    from public.merdp_manufacturer_product_relationships r0) membership
  left join public.etl_source_records p on p.id=membership.product_record_id
  where r.id=membership.id;

  -- Compare off-list NRNs to current products for prioritization only.
  with candidate_matches as (
    select r.id,
      count(distinct pr.source_record_id) match_count,
      count(distinct pr.raw_payload->>'ingredient_id') ingredient_count,
      bool_and(lower(regexp_replace(coalesce(pr.raw_payload->>'product_name',''),'[^[:alnum:]]','','g'))=
        lower(regexp_replace(coalesce(sr.raw_payload->>'product_name',''),'[^[:alnum:]]','','g'))) brand_agreement,
      bool_and(coalesce(pr.raw_payload->>'manufacturer_id','')=r.manufacturer_source_id) manufacturer_agreement,
      bool_and(lower(regexp_replace(coalesce(pr.raw_payload->>'composition',''),'[^[:alnum:]]','','g'))=
        lower(regexp_replace(coalesce(sr.raw_payload->>'composition',''),'[^[:alnum:]]','','g'))) composition_agreement,
      coalesce(jsonb_agg(distinct m.canonical_product_id) filter(where m.canonical_product_id is not null),'[]'::jsonb) canonical_ids
    from public.merdp_manufacturer_product_relationships r
    join public.etl_source_records sr on sr.id=r.source_record_id
    join public.merdp_latest_product_source_records pr
      on btrim(pr.raw_payload->>'NAFDAC')=btrim(r.evidence->>'nrn')
    left join public.merdp_source_mappings m on m.source_record_id=pr.id
    where r.source_state='OFF_LIST_SOURCE_EVIDENCE' and nullif(btrim(r.evidence->>'nrn'),'') is not null
    group by r.id
  )
  update public.merdp_manufacturer_product_relationships r set
    evidence_classification=case
      when c.ingredient_count>1 then 'CONFLICT'
      when c.match_count=1 and c.brand_agreement and c.manufacturer_agreement and c.composition_agreement
        then 'HIGH_CONFIDENCE_HISTORICAL_EQUIVALENCE'
      when jsonb_array_length(c.canonical_ids)>1 then 'AMBIGUOUS_EQUIVALENCE'
      else 'INSUFFICIENT_EVIDENCE' end,
    possible_canonical_product_ids=c.canonical_ids
  from candidate_matches c where c.id=r.id;

  if failure_stage='after_classification' then
    raise exception 'MERDP_REFERENCE_CONTROLLED_FAILURE_AFTER_CLASSIFICATION';
  end if;

  -- Only actionable ambiguity/conflict enters the existing review system.
  insert into public.merdp_quality_findings(run_id,source_record_id,rule_code,
    field_name,raw_value,severity,message)
  select sr.run_id,r.source_record_id,
    case when r.evidence_classification='CONFLICT' then 'OFF_LIST_SOURCE_CONFLICT'
      else 'OFF_LIST_EQUIVALENCE_REVIEW_REQUIRED' end,
    'product_id',r.product_source_id,
    'warning'::public.merdp_finding_severity,
    'Off-list manufacturer evidence requires governed identity review; it cannot establish current listing or publication'
  from public.merdp_manufacturer_product_relationships r
  join public.etl_source_records sr on sr.id=r.source_record_id
  where r.evidence_classification in ('AMBIGUOUS_EQUIVALENCE','CONFLICT')
  on conflict(run_id,source_record_id,rule_code,field_name) do nothing;

  insert into public.merdp_review_cases(source_record_id,quality_finding_id,reason_code,status,evidence,candidate_entities)
  select f.source_record_id,f.id,f.rule_code,'open',
    jsonb_build_object('sourceState',r.source_state,'classification',r.evidence_classification,
      'currentListingMembership',false,'manufacturerSourceId',r.manufacturer_source_id,
      'canonicalManufacturerId',i.canonical_organization_id,'nrn',r.evidence->>'nrn',
      'relationshipSnapshotId',r.snapshot_id,'publicationAuthority',false),
    r.possible_canonical_product_ids
  from public.merdp_quality_findings f
  join public.merdp_manufacturer_product_relationships r on r.source_record_id=f.source_record_id
  join public.merdp_manufacturer_identities i on i.id=r.manufacturer_identity_id
  where f.rule_code in ('OFF_LIST_EQUIVALENCE_REVIEW_REQUIRED','OFF_LIST_SOURCE_CONFLICT')
  on conflict(quality_finding_id) do nothing;

  if failure_stage='after_reviews' then
    raise exception 'MERDP_REFERENCE_CONTROLLED_FAILURE_AFTER_REVIEWS';
  end if;

  if (select count(*) from public.medicines)<>before_medicines
    or (select count(*) from public.organizations)<>before_organizations
    or (select count(*) from public.merdp_source_mappings)<>before_mappings
    or (select count(*) from public.merdp_certifications)<>before_certifications
    or (select count(*) from public.merdp_publications)<>before_publications
    or (select count(*) from public.prescriptions)<>before_prescriptions
    or (select count(*) from public.inventory_batches)<>before_inventory then
    raise exception 'NAFDAC_REFERENCE_CANONICAL_MUTATION_BOUNDARY_VIOLATION';
  end if;

  select jsonb_build_object(
    'durationMs',extract(epoch from clock_timestamp()-started_at)*1000,
    'relationships',(select count(*) from public.merdp_manufacturer_product_relationships),
    'currentListed',(select count(*) from public.merdp_manufacturer_product_relationships where source_state='CURRENT_LISTED'),
    'offList',(select count(*) from public.merdp_manufacturer_product_relationships where source_state='OFF_LIST_SOURCE_EVIDENCE'),
    'highConfidence',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='HIGH_CONFIDENCE_HISTORICAL_EQUIVALENCE'),
    'ambiguous',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='AMBIGUOUS_EQUIVALENCE'),
    'conflicts',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='CONFLICT'),
    'overlapInsufficient',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='INSUFFICIENT_EVIDENCE'),
    'sourceInsufficient',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='SOURCE_INSUFFICIENT'),
    'manualReviews',(select count(*) from public.merdp_review_cases where reason_code in ('OFF_LIST_EQUIVALENCE_REVIEW_REQUIRED','OFF_LIST_SOURCE_CONFLICT')),
    'canonicalMedicineDelta',0,'certificationDelta',0,'publicationDelta',0
  ) into result;
  return result;
end;
$$;

revoke all on function public.run_merdp_nafdac_reference_convergence(text,boolean) from public;
grant execute on function public.run_merdp_nafdac_reference_convergence(text,boolean) to service_role;

create or replace function public.merdp_nafdac_reference_state()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'relationships',(select count(*) from public.merdp_manufacturer_product_relationships),
    'currentListed',(select count(*) from public.merdp_manufacturer_product_relationships where source_state='CURRENT_LISTED'),
    'offList',(select count(*) from public.merdp_manufacturer_product_relationships where source_state='OFF_LIST_SOURCE_EVIDENCE'),
    'highConfidence',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='HIGH_CONFIDENCE_HISTORICAL_EQUIVALENCE'),
    'ambiguous',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='AMBIGUOUS_EQUIVALENCE'),
    'conflicts',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='CONFLICT'),
    'overlapInsufficient',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='INSUFFICIENT_EVIDENCE'),
    'sourceInsufficient',(select count(*) from public.merdp_manufacturer_product_relationships where evidence_classification='SOURCE_INSUFFICIENT'),
    'manualReviews',(select count(*) from public.merdp_review_cases where reason_code in ('OFF_LIST_EQUIVALENCE_REVIEW_REQUIRED','OFF_LIST_SOURCE_CONFLICT')),
    'quarantineCount',(select count(distinct source_record_id) from public.merdp_quality_findings where severity in ('quarantine','reject')),
    'certificationCount',(select count(*) from public.merdp_certifications where status='certified'),
    'publicationCount',(select count(*) from public.merdp_publications),
    'lastCompletedRun',(select max(completed_at) from public.etl_runs where status='completed'),
    'productSnapshotId',(select sn.id from public.etl_snapshots sn join public.etl_sources s on s.id=sn.source_id where s.source_code='NAFDAC_GREENBOOK' order by sn.received_at desc limit 1),
    'manufacturerSnapshotId',(select sn.id from public.etl_snapshots sn join public.etl_sources s on s.id=sn.source_id where s.source_code='NAFDAC_GREENBOOK_MANUFACTURERS' order by sn.received_at desc limit 1),
    'relationshipSnapshotId',(select sn.id from public.etl_snapshots sn join public.etl_sources s on s.id=sn.source_id where s.source_code='NAFDAC_GREENBOOK_MANUFACTURER_PRODUCTS' order by sn.received_at desc limit 1));
$$;
revoke all on function public.merdp_nafdac_reference_state() from public;
grant execute on function public.merdp_nafdac_reference_state() to service_role;
