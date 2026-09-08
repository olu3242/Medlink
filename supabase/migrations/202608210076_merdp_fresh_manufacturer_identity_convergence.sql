-- Converge a freshly approved manufacturer directory into stable source identities.
-- This path deliberately does not infer manufacturer-product relationships.

create or replace function public.run_merdp_fresh_manufacturer_identity_convergence(
  directory_sha256 text,
  expected_row_count integer
) returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='0'
as $$
declare
  directory_snapshot_id uuid;
  source_record_count bigint;
  source_mapping_count bigint;
  identity_count bigint;
  state_count bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'MERDP_FRESH_MANUFACTURER_SERVICE_ROLE_REQUIRED';
  end if;
  if directory_sha256 !~ '^[0-9a-f]{64}$' or expected_row_count <= 0 then
    raise exception 'MERDP_FRESH_MANUFACTURER_APPROVAL_INVALID';
  end if;

  select sn.id into directory_snapshot_id
  from public.etl_snapshots sn
  join public.etl_sources s on s.id=sn.source_id
  where s.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and sn.sha256=directory_sha256
    and sn.row_count=expected_row_count;
  if directory_snapshot_id is null then
    raise exception 'MERDP_FRESH_MANUFACTURER_SNAPSHOT_MISMATCH';
  end if;

  select count(*) into source_record_count
  from public.etl_source_records r
  where r.snapshot_id=directory_snapshot_id;
  if source_record_count <> expected_row_count then
    raise exception 'MERDP_FRESH_MANUFACTURER_RECORD_COUNT_MISMATCH';
  end if;

  select count(*) into source_mapping_count
  from public.merdp_manufacturer_source_links l
  join public.etl_source_records r on r.id=l.source_record_id
  where r.snapshot_id=directory_snapshot_id
    and l.canonical_organization_id is not null;
  if source_mapping_count <> expected_row_count then
    raise exception 'MERDP_FRESH_MANUFACTURER_MAPPING_COUNT_MISMATCH';
  end if;
  if exists (
    select 1 from public.merdp_manufacturer_source_links l
    join public.etl_source_records r on r.id=l.source_record_id
    where r.snapshot_id=directory_snapshot_id
    group by l.source_manufacturer_id
    having count(*)<>1 or count(distinct l.canonical_organization_id)<>1
  ) then raise exception 'MERDP_FRESH_MANUFACTURER_MAPPING_AMBIGUOUS'; end if;
  if exists (
    select 1 from public.merdp_manufacturer_identities i
    join public.merdp_manufacturer_source_links l
      on l.source_manufacturer_id=i.source_manufacturer_id
    join public.etl_source_records r on r.id=l.source_record_id
    where i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
      and r.snapshot_id=directory_snapshot_id
      and i.canonical_organization_id<>l.canonical_organization_id
  ) then raise exception 'MERDP_FRESH_MANUFACTURER_IDENTITY_REASSIGNMENT'; end if;
  if exists (
    select 1 from public.merdp_manufacturer_source_links l
    join public.etl_source_records r on r.id=l.source_record_id
    where r.snapshot_id=directory_snapshot_id
    group by l.canonical_organization_id
    having count(distinct l.source_manufacturer_id)>1
  ) then raise exception 'MERDP_FRESH_MANUFACTURER_UNSAFE_MERGE'; end if;

  insert into public.merdp_manufacturer_identities(
    source_code,source_manufacturer_id,canonical_organization_id,
    first_source_record_id,latest_source_record_id,identity_rule_version,
    reference_only,source_state,evidence)
  select 'NAFDAC_GREENBOOK_MANUFACTURERS',l.source_manufacturer_id,
    l.canonical_organization_id,r.id,r.id,'fresh-source-id-adopts-wave1-mapping-v1',
    coalesce((r.raw_payload->>'product_count')::integer,0)=0,'present',
    jsonb_build_object('namePrimaryKey',false,'adoptedWave1Mapping',true,
      'approvedDirectorySha256',directory_sha256,'snapshotId',directory_snapshot_id)
  from public.merdp_manufacturer_source_links l
  join public.etl_source_records r on r.id=l.source_record_id
  where r.snapshot_id=directory_snapshot_id
  on conflict(source_code,source_manufacturer_id) do update set
    latest_source_record_id=excluded.latest_source_record_id,
    reference_only=excluded.reference_only,
    source_state='present',
    evidence=public.merdp_manufacturer_identities.evidence || excluded.evidence,
    updated_at=now();

  insert into public.merdp_manufacturer_snapshot_states(
    snapshot_id,manufacturer_identity_id,state,source_record_id,evidence)
  select directory_snapshot_id,i.id,'present',r.id,
    jsonb_build_object('approvedDirectorySha256',directory_sha256,
      'sourceName',r.raw_payload->>'manufacturer_name')
  from public.etl_source_records r
  join public.merdp_manufacturer_identities i
    on i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and i.source_manufacturer_id=r.source_record_id
  where r.snapshot_id=directory_snapshot_id
  on conflict(snapshot_id,manufacturer_identity_id) do update set
    state='present',source_record_id=excluded.source_record_id,evidence=excluded.evidence;

  update public.merdp_manufacturer_identities i set source_state='absent',updated_at=now()
  where i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS'
    and not exists(select 1 from public.etl_source_records r
      where r.snapshot_id=directory_snapshot_id
        and r.source_record_id=i.source_manufacturer_id);

  select count(*) into identity_count
  from public.merdp_manufacturer_identities i
  where i.source_code='NAFDAC_GREENBOOK_MANUFACTURERS' and i.source_state='present';
  select count(*) into state_count
  from public.merdp_manufacturer_snapshot_states s
  where s.snapshot_id=directory_snapshot_id and s.state='present';
  if identity_count<>expected_row_count or state_count<>expected_row_count then
    raise exception 'MERDP_FRESH_MANUFACTURER_RECONCILIATION_FAILED';
  end if;

  return jsonb_build_object(
    'manufacturerIdentities',identity_count,
    'manufacturerSnapshotStates',state_count,
    'sourceMappings',source_mapping_count,
    'unsafeManufacturerMerges',0,
    'directorySnapshotId',directory_snapshot_id);
end;
$$;

revoke all on function public.run_merdp_fresh_manufacturer_identity_convergence(text,integer) from public;
grant execute on function public.run_merdp_fresh_manufacturer_identity_convergence(text,integer) to service_role;
