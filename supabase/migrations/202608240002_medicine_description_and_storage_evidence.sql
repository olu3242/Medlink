-- Greenbook canonical intelligence hardening, P1: product_description and
-- storage guidance. The medication-intelligence certification pass found
-- product_description entirely absent (no column, no code, no docs) and
-- medicines.storage_conditions defined but never written or read anywhere.
-- Re-reading packages/merdp/src/greenbook.ts's own productColumns list
-- shows the raw NAFDAC Greenbook CSV DOES carry a `product_description`
-- field and an `smpc` field (a reference to the product's Summary of
-- Product Characteristics document) -- both were captured into
-- etl_source_records.raw_payload on every ingest run but never projected
-- into any canonical table. This migration adds the two columns/tables and
-- a small, additive backfill RPC that reads those two already-ingested
-- fields -- it does not touch run_merdp_wave1_convergence (202608130024)
-- at all, so there is zero regression risk to the already-certified
-- convergence path; it only reuses the same merdp_source_mappings +
-- merdp_latest_product_source_records evidence that convergence already
-- established.
--
-- product_description: real Greenbook field, projected verbatim when
-- present. Never fabricated -- a medicine with no source value stays null.
--
-- Storage: Greenbook gives only an SMPC *reference* (a link/id to a
-- document), never storage instruction text itself, and no SMPC-document
-- extraction/parsing pipeline exists anywhere in this codebase (confirmed:
-- zero code references `smpc` outside this column list and the acquisition
-- script). medicine_storage_guidance therefore models the real state of
-- evidence honestly: a row records that an SMPC reference exists and needs
-- human/pipeline review (NEEDS_REVIEW), or that none exists (UNAVAILABLE).
-- SOURCE_STRUCTURED (the source itself carries structured storage data) and
-- EXTRACTED (a real extraction pipeline derived text from the referenced
-- document) are both reserved for future work this migration does not
-- claim to have done -- no row is ever inserted in either state here.

alter table public.medicines
  add column product_description text check (product_description is null or char_length(product_description) between 1 and 4000);

comment on column public.medicines.product_description is
  'Verbatim NAFDAC Greenbook product_description field (raw_payload."product_description"), backfilled by run_merdp_descriptive_evidence_backfill. Null when the source record has no description -- never inferred from brand/generic/dosage/strength.';

create type public.medicine_storage_extraction_state as enum (
  'SOURCE_STRUCTURED', 'EXTRACTED', 'NEEDS_REVIEW', 'UNAVAILABLE'
);

create table public.medicine_storage_guidance (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete cascade,
  source_system text not null check (char_length(source_system) between 2 and 60),
  raw_text text check (raw_text is null or char_length(raw_text) between 1 and 4000),
  normalized_text text check (normalized_text is null or char_length(normalized_text) between 1 and 4000),
  source_reference text check (source_reference is null or char_length(source_reference) between 1 and 500),
  extraction_state public.medicine_storage_extraction_state not null default 'UNAVAILABLE',
  winning_source_record_id uuid references public.etl_source_records(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medicine_id, source_system),
  -- A structured or extracted claim must carry real text and its source
  -- record -- this is the schema-level backstop for "never generate
  -- regulatory storage instructions from an LLM without source evidence".
  -- NEEDS_REVIEW/UNAVAILABLE never require raw_text (that is precisely the
  -- honest "we don't have extracted text yet" state).
  check (
    (extraction_state in ('SOURCE_STRUCTURED', 'EXTRACTED')
      and raw_text is not null and winning_source_record_id is not null)
    or extraction_state in ('NEEDS_REVIEW', 'UNAVAILABLE')
  ),
  check (
    (reviewed_by is null and reviewed_at is null)
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index medicine_storage_guidance_medicine_idx
  on public.medicine_storage_guidance(medicine_id);
create index medicine_storage_guidance_needs_review_idx
  on public.medicine_storage_guidance(medicine_id)
  where extraction_state = 'NEEDS_REVIEW';

create trigger medicine_storage_guidance_set_updated_at
before update on public.medicine_storage_guidance
for each row execute function public.set_updated_at();

alter table public.medicine_storage_guidance enable row level security;

-- Same read/admin shape as medicine_registrations_read/medicine_registrations_admin
-- (202607270002): globally readable evidence, platform-admin-writable, plus
-- the service-role-only backfill RPC below for the governed pipeline path.
create policy medicine_storage_guidance_read
  on public.medicine_storage_guidance for select to authenticated
  using (exists (
    select 1 from public.medicines medicine
    where medicine.id = medicine_id
      and medicine.deleted_at is null
      and medicine.status = 'active'
  ));
create policy medicine_storage_guidance_admin
  on public.medicine_storage_guidance for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Pharmacist review authority over this global (non-tenant) evidence table
-- is intentionally deferred, not implemented here: every existing
-- pharmacist-role check in this codebase (has_organization_role) is
-- tenant-scoped by construction, and this table has no organization_id to
-- scope against (it is global regulatory evidence, like
-- medicine_registrations). Reviewing/advancing extraction_state today goes
-- through is_platform_admin() only; a cross-tenant pharmacist-review
-- authorization model is a separate, deliberately out-of-scope design
-- decision, not an oversight.

grant select on public.medicine_storage_guidance to authenticated;
grant select, insert, update on public.medicine_storage_guidance to service_role;

create table public.merdp_canonical_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  triggered_by uuid references auth.users(id),
  product_snapshot_id uuid references public.etl_snapshots(id),
  manufacturer_snapshot_id uuid references public.etl_snapshots(id),
  descriptions_backfilled bigint not null default 0,
  storage_rows_upserted bigint not null default 0,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);

alter table public.merdp_canonical_refresh_runs enable row level security;
grant select, insert on public.merdp_canonical_refresh_runs to service_role;

comment on table public.merdp_canonical_refresh_runs is
  'Audit trail for run_merdp_descriptive_evidence_backfill invocations: which Greenbook snapshot was current, and how many medicines/storage rows changed. Not a regulatory-status source -- purely operational drift visibility.';

-- Additive, service-role-only backfill. Reuses merdp_source_mappings +
-- merdp_latest_product_source_records exactly as run_merdp_wave1_convergence
-- does (202608130024) rather than re-deriving canonical identity; does not
-- redefine or touch that function. Safe to call repeatedly: every write is
-- guarded by IS DISTINCT FROM, so a call against unchanged source data is a
-- true no-op (idempotent, replay-safe), and it never deletes rows.
create or replace function public.run_merdp_descriptive_evidence_backfill(
  failure_stage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  started_at timestamptz := clock_timestamp();
  descriptions_backfilled bigint := 0;
  storage_rows_upserted bigint := 0;
  product_snapshot uuid;
  manufacturer_snapshot uuid;
  refresh_id uuid;
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'MERDP descriptive evidence backfill requires the service-role operating context'
      using errcode = '42501';
  end if;

  select sn.id into product_snapshot
  from public.etl_snapshots sn join public.etl_sources s on s.id = sn.source_id
  where s.source_code = 'NAFDAC_GREENBOOK' order by sn.received_at desc limit 1;
  select sn.id into manufacturer_snapshot
  from public.etl_snapshots sn join public.etl_sources s on s.id = sn.source_id
  where s.source_code = 'NAFDAC_GREENBOOK_MANUFACTURERS' order by sn.received_at desc limit 1;

  with updated as (
    update public.medicines med set
      product_description = nullif(btrim(r.raw_payload->>'product_description'), ''),
      updated_at = now()
    from public.merdp_source_mappings m
    join public.merdp_latest_product_source_records r on r.id = m.source_record_id
    where m.canonical_product_id = med.id
      and nullif(btrim(r.raw_payload->>'product_description'), '') is not null
      and med.product_description is distinct from nullif(btrim(r.raw_payload->>'product_description'), '')
    returning med.id
  )
  select count(*) into descriptions_backfilled from updated;

  if failure_stage = 'after_description_backfill' then
    raise exception 'MERDP_CONTROLLED_FAILURE_AFTER_DESCRIPTION_BACKFILL';
  end if;

  with source as (
    select m.canonical_product_id as medicine_id, r.id as source_record_id,
      nullif(btrim(r.raw_payload->>'smpc'), '') as smpc_reference
    from public.merdp_source_mappings m
    join public.merdp_latest_product_source_records r on r.id = m.source_record_id
    where m.canonical_product_id is not null
  ), upserted as (
    insert into public.medicine_storage_guidance(
      medicine_id, source_system, source_reference, winning_source_record_id,
      extraction_state
    )
    select medicine_id, 'NAFDAC_GREENBOOK', smpc_reference, source_record_id,
      case when smpc_reference is not null then 'NEEDS_REVIEW'::public.medicine_storage_extraction_state
        else 'UNAVAILABLE'::public.medicine_storage_extraction_state end
    from source
    on conflict (medicine_id, source_system) do update set
      source_reference = excluded.source_reference,
      winning_source_record_id = excluded.winning_source_record_id,
      -- Never regress a row a human/pipeline already advanced past the
      -- source-evidence-only states just because this backfill re-ran.
      extraction_state = case
        when medicine_storage_guidance.extraction_state in ('SOURCE_STRUCTURED', 'EXTRACTED')
          then medicine_storage_guidance.extraction_state
        else excluded.extraction_state
      end,
      updated_at = now()
    where medicine_storage_guidance.source_reference is distinct from excluded.source_reference
       or medicine_storage_guidance.extraction_state is distinct from excluded.extraction_state
    returning medicine_storage_guidance.id
  )
  select count(*) into storage_rows_upserted from upserted;

  insert into public.merdp_canonical_refresh_runs(
    triggered_by, product_snapshot_id, manufacturer_snapshot_id,
    descriptions_backfilled, storage_rows_upserted, started_at
  ) values (
    auth.uid(), product_snapshot, manufacturer_snapshot,
    descriptions_backfilled, storage_rows_upserted, started_at
  ) returning id into refresh_id;

  select jsonb_build_object(
    'durationMs', extract(epoch from clock_timestamp() - started_at) * 1000,
    'refreshRunId', refresh_id,
    'productSnapshotId', product_snapshot,
    'manufacturerSnapshotId', manufacturer_snapshot,
    'descriptionsBackfilled', descriptions_backfilled,
    'storageRowsUpserted', storage_rows_upserted
  ) into result;
  return result;
end;
$$;

revoke all on function public.run_merdp_descriptive_evidence_backfill(text) from public;
grant execute on function public.run_merdp_descriptive_evidence_backfill(text) to service_role;

comment on function public.run_merdp_descriptive_evidence_backfill is
  'Additive MERDP freshness step: projects the already-ingested Greenbook product_description and smpc reference fields onto medicines/medicine_storage_guidance. Reuses merdp_source_mappings/merdp_latest_product_source_records (the same evidence run_merdp_wave1_convergence uses) rather than re-deriving identity; never invents description or storage text, only ever narrows null to a real source value or leaves it null. Idempotent and replay-safe: every write is guarded by IS DISTINCT FROM, so re-running against unchanged source data is a true no-op. Records one merdp_canonical_refresh_runs audit row per call.';
