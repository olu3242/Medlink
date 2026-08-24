-- Fixes a real CI failure surfaced on descriptive-evidence-backfill-live.test.ts:
-- "permission denied for table medicines". public.medicines (202607270002)
-- was never granted to service_role for direct PostgREST access -- unlike
-- etl_sources/etl_snapshots/etl_runs/etl_source_records/merdp_source_mappings,
-- which 202608120022 already grants to service_role. Every other live-test
-- fixture in this codebase that needs to WRITE a table service_role cannot
-- reach directly does so from inside a SECURITY DEFINER function instead of
-- widening the table grant (see 202608160038, 202608180081, 202608180082's
-- own comments on this exact gap class) -- this follows the same pattern for
-- the insert. Reading the medicine back afterward to assert on it is the
-- same narrow, read-only need 202608150033 already established a precedent
-- for on inventory_batches, so that part is a plain SELECT grant rather than
-- another wrapper function.
grant select on public.medicines to service_role;

create or replace function public.certify_descriptive_evidence_backfill_fixture(
  fixture_key text,
  target_product_description text,
  target_smpc_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  medicine_id uuid := gen_random_uuid();
  source_id uuid;
  snapshot_id uuid := gen_random_uuid();
  run_id uuid := gen_random_uuid();
  source_record_id uuid := gen_random_uuid();
  raw_payload jsonb;
begin
  if auth.role() <> 'service_role' or fixture_key !~ '^[a-z0-9-]{6,80}$' then
    raise exception 'service-role certification context required' using errcode = '42501';
  end if;

  insert into public.medicines(
    id, brand_name, generic_name, dosage_form, route, strength_display, status
  ) values (
    medicine_id, 'Descriptive Backfill Fixture ' || fixture_key,
    'descriptive-backfill-fixture-generic-' || fixture_key,
    'tablet', 'oral', '500 mg', 'active'
  );

  select id into source_id from public.etl_sources where source_code = 'NAFDAC_GREENBOOK';

  insert into public.etl_snapshots(
    id, source_id, artifact_name, artifact_uri, sha256, byte_size,
    schema_fingerprint, row_count, column_count
  ) values (
    snapshot_id, source_id, 'descriptive-backfill-fixture-' || fixture_key || '.csv',
    'certification://descriptive-backfill-fixture/' || fixture_key,
    encode(public.digest(convert_to(fixture_key, 'UTF8'), 'sha256'), 'hex'),
    1, 'descriptive-backfill-fixture-' || fixture_key, 1, 1
  );

  insert into public.etl_runs(
    id, source_id, snapshot_id, status, started_at, completed_at,
    rows_read, rows_valid, rows_staged
  ) values (
    run_id, source_id, snapshot_id, 'completed', now(), now(), 1, 1, 1
  );

  raw_payload := jsonb_build_object(
    'product_description', target_product_description, 'smpc', target_smpc_reference
  );
  insert into public.etl_source_records(
    id, source_id, snapshot_id, run_id, source_record_id, schema_version,
    raw_payload, raw_payload_sha256
  ) values (
    source_record_id, source_id, snapshot_id, run_id,
    'descriptive-backfill-fixture-' || fixture_key, 'greenbook-product-v1',
    raw_payload, encode(public.digest(convert_to(raw_payload::text, 'UTF8'), 'sha256'), 'hex')
  );

  insert into public.merdp_source_mappings(
    source_record_id, canonical_product_id, resolution, evidence
  ) values (
    source_record_id, medicine_id, 'distinct',
    jsonb_build_object('method', 'descriptive-backfill-fixture')
  );

  return jsonb_build_object('medicineId', medicine_id, 'sourceRecordId', source_record_id);
end;
$$;

revoke all on function public.certify_descriptive_evidence_backfill_fixture(text, text, text)
from public, anon, authenticated;
grant execute on function public.certify_descriptive_evidence_backfill_fixture(text, text, text)
to service_role;

comment on function public.certify_descriptive_evidence_backfill_fixture is
  'Test-only fixture for the MERDP descriptive-evidence-backfill live suite: one medicine, one NAFDAC_GREENBOOK ETL source record carrying product_description/smpc, and the source mapping linking them. Not part of the application runtime; granted to service_role only.';
