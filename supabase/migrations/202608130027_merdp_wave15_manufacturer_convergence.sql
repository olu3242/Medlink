-- Governed Wave 1.5 manufacturer identity and relationship convergence.
-- This is deliberately a database-side bulk transaction, not a REST workflow.

create table public.merdp_manufacturer_identities (
  id uuid primary key default gen_random_uuid(),
  source_code text not null,
  source_manufacturer_id text not null,
  canonical_organization_id uuid not null references public.organizations(id),
  first_source_record_id uuid not null references public.etl_source_records(id),
  latest_source_record_id uuid not null references public.etl_source_records(id),
  identity_rule_version text not null,
  reference_only boolean not null default false,
  source_state text not null default 'present' check (source_state in ('present','absent')),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_code, source_manufacturer_id),
  unique(source_code, canonical_organization_id)
);

create table public.merdp_manufacturer_snapshot_states (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.etl_snapshots(id),
  manufacturer_identity_id uuid not null references public.merdp_manufacturer_identities(id),
  state text not null check (state in ('present','absent')),
  source_record_id uuid references public.etl_source_records(id),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(snapshot_id, manufacturer_identity_id)
);

create table public.merdp_manufacturer_product_relationships (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null unique references public.etl_source_records(id),
  snapshot_id uuid not null references public.etl_snapshots(id),
  manufacturer_identity_id uuid not null references public.merdp_manufacturer_identities(id),
  manufacturer_source_id text not null,
  product_source_id text not null,
  canonical_product_id uuid references public.medicines(id),
  resolution text not null check (resolution in ('known_wave1_product','source_product_not_yet_ingested','conflict')),
  is_current boolean not null default true,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  unique(snapshot_id, manufacturer_source_id, product_source_id)
);

create index merdp_manufacturer_relationship_product_idx
  on public.merdp_manufacturer_product_relationships(product_source_id);
create index merdp_manufacturer_relationship_identity_idx
  on public.merdp_manufacturer_product_relationships(manufacturer_identity_id);

alter table public.merdp_manufacturer_identities enable row level security;
alter table public.merdp_manufacturer_snapshot_states enable row level security;
alter table public.merdp_manufacturer_product_relationships enable row level security;
grant select,insert,update on public.merdp_manufacturer_identities,
  public.merdp_manufacturer_snapshot_states,
  public.merdp_manufacturer_product_relationships to service_role;

create or replace function public.run_merdp_wave15_manufacturer_convergence(
  directory_sha256 text default '0a65586bf88a3e46af20f7bd9bf5ace6b18e6f0964a28445f5c703b33a0ec49a',
  relationships_sha256 text default 'b90bb4d2bfbc1a883a25e1aa7bfd6c711072f3ebedb33e5eb8b3da9ea65b1152',
  failure_stage text default null,
  enforce_certified_baseline boolean default true
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='0'
as $$
declare
  started_at timestamptz := clock_timestamp();
  directory_snapshot_id uuid;
  relationship_snapshot_id uuid;
  before_organizations bigint;
  before_certifications bigint;
  before_publications bigint;
  conflict_count bigint;
  result jsonb;
begin
  select sn.id into directory_snapshot_id
  from public.etl_snapshots sn join public.etl_sources s on s.id=sn.source_id
  where s.source_code='NAFDAC_GREENBOOK_MANUFACTURERS' and sn.sha256=directory_sha256;
  select sn.id into relationship_snapshot_id
  from public.etl_snapshots sn join public.etl_sources s on s.id=sn.source_id
  where s.source_code='NAFDAC_GREENBOOK_MANUFACTURER_PRODUCTS' and sn.sha256=relationships_sha256;
  if directory_snapshot_id is null or relationship_snapshot_id is null then
    raise exception 'WAVE15_CERTIFIED_INPUT_MISSING';
  end if;
  if enforce_certified_baseline and not exists (
    select 1 from public.etl_snapshots where id=directory_snapshot_id and row_count=1389
  ) then raise exception 'WAVE15_DIRECTORY_BASELINE_MISMATCH'; end if;
  if enforce_certified_baseline and not exists (
    select 1 from public.etl_snapshots where id=relationship_snapshot_id and row_count=11707
  ) then raise exception 'WAVE15_RELATIONSHIP_BASELINE_MISMATCH'; end if;

  select count(*) into before_organizations from public.organizations
    where slug like 'nafdac-manufacturer-%';
  select count(*) into before_certifications from public.merdp_certifications;
  select count(*) into before_publications from public.merdp_publications;

  -- Adopt the existing Wave 1 mappings without replacing their organization IDs.
  insert into public.merdp_manufacturer_identities(
    source_code,source_manufacturer_id,canonical_organization_id,
    first_source_record_id,latest_source_record_id,identity_rule_version,evidence)
  select 'NAFDAC_GREENBOOK_MANUFACTURERS',l.source_manufacturer_id,
    min(l.canonical_organization_id::text)::uuid,min(l.source_record_id::text)::uuid,
    min(l.source_record_id::text)::uuid,'wave1-source-identity-preserved-v1',
    jsonb_build_object('namePrimaryKey',false,'adoptedWave1Mapping',true)
  from public.merdp_manufacturer_source_links l
  where l.canonical_organization_id is not null
  group by l.source_manufacturer_id
  having count(distinct l.canonical_organization_id)=1
  on conflict(source_code,source_manufacturer_id) do nothing;

  -- Only directory identities absent from the stable registry get new UUIDv5 IDs.
  insert into public.organizations(id,name,slug,type,branding)
  select extensions.uuid_generate_v5(
      '6ba7b811-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'NAFDAC_GREENBOOK_MANUFACTURERS:manufacturer:' || r.source_record_id),
    r.raw_payload->>'manufacturer_name','nafdac-manufacturer-'||lower(r.source_record_id),
    'manufacturer',jsonb_build_object('source','NAFDAC Greenbook',
      'sourceManufacturerId',r.source_record_id,'referenceOnly',true)
  from public.etl_source_records r
  where r.snapshot_id=directory_snapshot_id
    and nullif(btrim(r.raw_payload->>'manufacturer_name'),'') is not null
    and not exists(select 1 from public.merdp_manufacturer_identities i
      where i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
        and i.source_manufacturer_id=r.source_record_id)
  on conflict(slug) do nothing;

  insert into public.merdp_manufacturer_identities(
    source_code,source_manufacturer_id,canonical_organization_id,
    first_source_record_id,latest_source_record_id,identity_rule_version,
    reference_only,source_state,evidence)
  select 'NAFDAC_GREENBOOK_MANUFACTURERS',r.source_record_id,o.id,r.id,r.id,
    'source-system-entity-source-id-v2',
    coalesce((r.raw_payload->>'product_count')::integer,0)=0,'present',
    jsonb_build_object('namePrimaryKey',false,'sourceEntityType','manufacturer',
      'sourceName',r.raw_payload->>'manufacturer_name')
  from public.etl_source_records r join public.organizations o
    on o.slug='nafdac-manufacturer-'||lower(r.source_record_id)
  where r.snapshot_id=directory_snapshot_id
  on conflict(source_code,source_manufacturer_id) do update set
    latest_source_record_id=excluded.latest_source_record_id,
    source_state='present',
    evidence=public.merdp_manufacturer_identities.evidence || excluded.evidence,
    updated_at=now();

  -- Newer display evidence may update the canonical display value; identity never changes.
  update public.organizations o set name=r.raw_payload->>'manufacturer_name',updated_at=now()
  from public.merdp_manufacturer_identities i join public.etl_source_records r
    on r.id=i.latest_source_record_id
  where i.canonical_organization_id=o.id
    and i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and o.name is distinct from r.raw_payload->>'manufacturer_name';

  insert into public.merdp_manufacturer_source_links(
    source_record_id,source_manufacturer_id,canonical_organization_id,resolution,evidence)
  select r.id,r.source_record_id,i.canonical_organization_id,'distinct',
    jsonb_build_object('method',i.identity_rule_version,'nameNotPrimaryKey',true,
      'snapshotId',directory_snapshot_id)
  from public.etl_source_records r join public.merdp_manufacturer_identities i
    on i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and i.source_manufacturer_id=r.source_record_id
  where r.snapshot_id=directory_snapshot_id
  on conflict(source_record_id,source_manufacturer_id) do nothing;

  insert into public.merdp_manufacturer_snapshot_states(
    snapshot_id,manufacturer_identity_id,state,source_record_id,evidence)
  select directory_snapshot_id,i.id,'present',r.id,
    jsonb_build_object('sourceName',r.raw_payload->>'manufacturer_name')
  from public.etl_source_records r join public.merdp_manufacturer_identities i
    on i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and i.source_manufacturer_id=r.source_record_id
  where r.snapshot_id=directory_snapshot_id
  on conflict(snapshot_id,manufacturer_identity_id) do nothing;
  insert into public.merdp_manufacturer_snapshot_states(
    snapshot_id,manufacturer_identity_id,state,evidence)
  select directory_snapshot_id,i.id,'absent',jsonb_build_object(
    'policy','retain-identity-no-automatic-revocation')
  from public.merdp_manufacturer_identities i
  where i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and not exists(select 1 from public.etl_source_records r
      where r.snapshot_id=directory_snapshot_id
        and r.source_record_id=i.source_manufacturer_id)
  on conflict(snapshot_id,manufacturer_identity_id) do nothing;
  update public.merdp_manufacturer_identities i set source_state='absent',updated_at=now()
  where i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and not exists(select 1 from public.etl_source_records r
      where r.snapshot_id=directory_snapshot_id
        and r.source_record_id=i.source_manufacturer_id);

  insert into public.merdp_provenance(canonical_organization_id,attribute_name,
    winning_value,winning_source_record_id,rule_version,candidate_values)
  select i.canonical_organization_id,'manufacturer_source_identity',
    jsonb_build_object('sourceCode',i.source_code,'sourceManufacturerId',i.source_manufacturer_id,
      'referenceOnly',i.reference_only),r.id,'manufacturer-source-identity-v2',
    jsonb_build_array(jsonb_build_object('sourceName',r.raw_payload->>'manufacturer_name'))
  from public.merdp_manufacturer_identities i join public.etl_source_records r
    on r.id=i.latest_source_record_id
  where not exists(select 1 from public.merdp_provenance p
    where p.canonical_organization_id=i.canonical_organization_id
      and p.attribute_name='manufacturer_source_identity'
      and p.winning_source_record_id=r.id)
  on conflict do nothing;

  if failure_stage='after_organizations' then
    raise exception 'MERDP_WAVE15_CONTROLLED_FAILURE_AFTER_ORGANIZATIONS';
  end if;

  -- A relationship contradicting the certified product manufacturer is review evidence,
  -- never an instruction to overwrite the Wave 1 lineage.
  insert into public.merdp_manufacturer_product_relationships(
    source_record_id,snapshot_id,manufacturer_identity_id,manufacturer_source_id,
    product_source_id,canonical_product_id,resolution,evidence)
  select rr.id,relationship_snapshot_id,i.id,rr.raw_payload->>'manufacturer_source_id',
    rr.raw_payload->>'product_id',
    case when pr.id is not null and pr.raw_payload->>'manufacturer_id'=rr.raw_payload->>'manufacturer_source_id'
      then pm.canonical_product_id else null end,
    case when pr.id is null then 'source_product_not_yet_ingested'
      when pr.raw_payload->>'manufacturer_id'<>rr.raw_payload->>'manufacturer_source_id' then 'conflict'
      else 'known_wave1_product' end,
    jsonb_build_object('directorySnapshotId',directory_snapshot_id,
      'relationshipSnapshotId',relationship_snapshot_id,'sourceArtifactSha256',relationships_sha256,
      'retrievalEvidence',rr.raw_payload->>'detail_source_url','productName',rr.raw_payload->>'product_name',
      'nrn',rr.raw_payload->>'nrn','manufacturerName',rr.raw_payload->>'manufacturer_source_name')
  from public.etl_source_records rr
  join public.merdp_manufacturer_identities i
    on i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and i.source_manufacturer_id=rr.raw_payload->>'manufacturer_source_id'
  left join public.merdp_latest_product_source_records pr
    on pr.source_record_id=rr.raw_payload->>'product_id'
  left join public.merdp_source_mappings pm on pm.source_record_id=pr.id
  where rr.snapshot_id=relationship_snapshot_id
  on conflict(source_record_id) do nothing;

  -- Snapshot absence changes current-state evidence, never historical rows.
  update public.merdp_manufacturer_product_relationships historical
  set is_current=exists(
    select 1 from public.merdp_manufacturer_product_relationships current
    where current.snapshot_id=relationship_snapshot_id
      and current.manufacturer_source_id=historical.manufacturer_source_id
      and current.product_source_id=historical.product_source_id)
  where historical.manufacturer_identity_id in (
    select id from public.merdp_manufacturer_identities
    where source_code='NAFDAC_GREENBOOK_MANUFACTURERS');

  insert into public.merdp_quality_findings(run_id,source_record_id,rule_code,
    field_name,raw_value,severity,message)
  select sr.run_id,r.source_record_id,'SOURCE_PRODUCT_NOT_YET_INGESTED','product_id',
    r.product_source_id,'info','Manufacturer relationship references a product outside the certified Wave 1 snapshot'
  from public.merdp_manufacturer_product_relationships r
  join public.etl_source_records sr on sr.id=r.source_record_id
  where r.snapshot_id=relationship_snapshot_id
    and r.resolution='source_product_not_yet_ingested'
  on conflict(run_id,source_record_id,rule_code,field_name) do nothing;
  insert into public.merdp_quality_findings(run_id,source_record_id,rule_code,
    field_name,raw_value,severity,message)
  select sr.run_id,r.source_record_id,'MANUFACTURER_PRODUCT_CONFLICT','manufacturer_source_id',
    r.manufacturer_source_id,'quarantine','Relationship contradicts certified Wave 1 manufacturer identity'
  from public.merdp_manufacturer_product_relationships r
  join public.etl_source_records sr on sr.id=r.source_record_id
  where r.snapshot_id=relationship_snapshot_id and r.resolution='conflict'
  on conflict(run_id,source_record_id,rule_code,field_name) do nothing;

  insert into public.merdp_review_cases(source_record_id,quality_finding_id,reason_code,status,evidence)
  select f.source_record_id,f.id,f.rule_code,'open',jsonb_build_object('severity',f.severity,
    'policy','do-not-overwrite-wave1-lineage')
  from public.merdp_quality_findings f
  where f.rule_code='MANUFACTURER_PRODUCT_CONFLICT'
    and f.source_record_id in (select source_record_id from public.merdp_manufacturer_product_relationships
      where snapshot_id=relationship_snapshot_id)
  on conflict(quality_finding_id) do nothing;

  insert into public.merdp_provenance(canonical_product_id,attribute_name,winning_value,
    winning_source_record_id,rule_version,candidate_values)
  select r.canonical_product_id,'manufacturer_relationship:'||r.manufacturer_source_id,
    jsonb_build_object('manufacturerSourceId',r.manufacturer_source_id,
      'canonicalOrganizationId',i.canonical_organization_id,'productSourceId',r.product_source_id),
    r.source_record_id,'manufacturer-product-relationship-v1','[]'::jsonb
  from public.merdp_manufacturer_product_relationships r
  join public.merdp_manufacturer_identities i on i.id=r.manufacturer_identity_id
  where r.snapshot_id=relationship_snapshot_id and r.resolution='known_wave1_product'
    and r.canonical_product_id is not null
  on conflict do nothing;

  select count(*) into conflict_count from public.merdp_manufacturer_product_relationships
    where snapshot_id=relationship_snapshot_id and resolution='conflict';
  if enforce_certified_baseline and conflict_count<>0 then
    raise exception 'WAVE15_RELATIONSHIP_CONFLICTS: %',conflict_count;
  end if;
  if failure_stage='after_relationships' then
    raise exception 'MERDP_WAVE15_CONTROLLED_FAILURE_AFTER_RELATIONSHIPS';
  end if;
  if (select count(*) from public.merdp_certifications)<>before_certifications
    or (select count(*) from public.merdp_publications)<>before_publications then
    raise exception 'WAVE15_MEDICINE_PUBLICATION_BOUNDARY_VIOLATION';
  end if;

  select jsonb_build_object(
    'durationMs',extract(epoch from clock_timestamp()-started_at)*1000,
    'sourceScopedOrganizations',(select count(*) from public.merdp_manufacturer_identities
      where source_code='NAFDAC_GREENBOOK_MANUFACTURERS'),
    'organizationDelta',(select count(*) from public.organizations
      where slug like 'nafdac-manufacturer-%')-before_organizations,
    'manufacturerMappings',(select count(*) from public.merdp_manufacturer_identities
      where source_code='NAFDAC_GREENBOOK_MANUFACTURERS'),
    'relationships',(select count(*) from public.merdp_manufacturer_product_relationships
      where snapshot_id=relationship_snapshot_id),
    'knownProducts',(select count(*) from public.merdp_manufacturer_product_relationships
      where snapshot_id=relationship_snapshot_id and resolution='known_wave1_product'),
    'unknownProducts',(select count(*) from public.merdp_manufacturer_product_relationships
      where snapshot_id=relationship_snapshot_id and resolution='source_product_not_yet_ingested'),
    'conflicts',conflict_count,
    'candidateFindings',(select count(*) from public.merdp_quality_findings
      where rule_code='SOURCE_PRODUCT_NOT_YET_INGESTED'),
    'certificationDelta',(select count(*) from public.merdp_certifications)-before_certifications,
    'publicationDelta',(select count(*) from public.merdp_publications)-before_publications
  ) into result;
  return result;
end;
$$;

revoke all on function public.run_merdp_wave15_manufacturer_convergence(text,text,text,boolean) from public;
grant execute on function public.run_merdp_wave15_manufacturer_convergence(text,text,text,boolean) to service_role;

create or replace function public.merdp_wave15_state()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'manufacturerIdentities',(select count(*) from public.merdp_manufacturer_identities),
    'referenceOnly',(select count(*) from public.merdp_manufacturer_identities where reference_only),
    'relationships',(select count(*) from public.merdp_manufacturer_product_relationships),
    'knownRelationships',(select count(*) from public.merdp_manufacturer_product_relationships where resolution='known_wave1_product'),
    'unknownCandidates',(select count(*) from public.merdp_manufacturer_product_relationships where resolution='source_product_not_yet_ingested'),
    'conflicts',(select count(*) from public.merdp_manufacturer_product_relationships where resolution='conflict'),
    'orphanRelationships',(select count(*) from public.merdp_manufacturer_product_relationships r
      where not exists(select 1 from public.merdp_manufacturer_identities i where i.id=r.manufacturer_identity_id))
  );
$$;
revoke all on function public.merdp_wave15_state() from public;
grant execute on function public.merdp_wave15_state() to service_role;
