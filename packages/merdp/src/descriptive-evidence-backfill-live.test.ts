import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && serviceKey ? describe : describe.skip;

// P1 live certification for 202608240002_medicine_description_and_storage_evidence.sql:
// proves, against a real Postgres instance, that
// run_merdp_descriptive_evidence_backfill projects a real (already-ingested)
// Greenbook product_description verbatim onto medicines.product_description,
// records the smpc reference as NEEDS_REVIEW storage evidence (never
// fabricating extracted text), is idempotent on replay, never deletes the
// canonical medicine, and records an auditable
// merdp_canonical_refresh_runs row. NOT_EXECUTED_ENVIRONMENT_BLOCK when
// Docker/PostgreSQL is unavailable.
live("MERDP descriptive evidence backfill (P1 live proof)", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;
  let medicineId: string;
  const productDescription = `Certification-only synthetic description ${nonce} -- not real NAFDAC data.`;
  const smpcReference = `smpc-reference-${nonce}`;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });

    const medicine = await service.from("medicines").insert({
      brand_name: `Descriptive Backfill Fixture ${nonce}`,
      generic_name: `descriptive-backfill-fixture-generic-${nonce}`,
      dosage_form: "tablet", route: "oral", strength_display: "500 mg",
      status: "active",
    }).select("id").single();
    if (medicine.error) throw medicine.error;
    medicineId = medicine.data.id as string;

    const source = await service.from("etl_sources").select("id")
      .eq("source_code", "NAFDAC_GREENBOOK").single();
    if (source.error) throw source.error;

    const snapshot = await service.from("etl_snapshots").insert({
      source_id: source.data.id, artifact_name: `descriptive-backfill-fixture-${nonce}.csv`,
      artifact_uri: `certification://descriptive-backfill-fixture/${nonce}`,
      sha256: createHash("sha256").update(nonce).digest("hex"),
      byte_size: 1, schema_fingerprint: `descriptive-backfill-fixture-${nonce}`,
      row_count: 1, column_count: 1,
    }).select("id").single();
    if (snapshot.error) throw snapshot.error;

    const run = await service.from("etl_runs").insert({
      source_id: source.data.id, snapshot_id: snapshot.data.id, status: "completed",
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      rows_read: 1, rows_valid: 1, rows_staged: 1,
    }).select("id").single();
    if (run.error) throw run.error;

    const rawPayload = { product_description: productDescription, smpc: smpcReference };
    const sourceRecord = await service.from("etl_source_records").insert({
      source_id: source.data.id, snapshot_id: snapshot.data.id, run_id: run.data.id,
      source_record_id: `descriptive-backfill-fixture-${nonce}`, schema_version: "greenbook-product-v1",
      raw_payload: rawPayload,
      raw_payload_sha256: createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex"),
    }).select("id").single();
    if (sourceRecord.error) throw sourceRecord.error;

    const mapping = await service.from("merdp_source_mappings").insert({
      source_record_id: sourceRecord.data.id, canonical_product_id: medicineId,
      resolution: "distinct", evidence: { method: "descriptive-backfill-fixture" },
    });
    if (mapping.error) throw mapping.error;
  }, 60_000);

  it("projects Greenbook product_description verbatim onto the canonical medicine, records smpc as NEEDS_REVIEW storage evidence, is idempotent on replay, and is audited", async () => {
    const beforeMedicine = await service.from("medicines").select("product_description")
      .eq("id", medicineId).single();
    expect(beforeMedicine.error, JSON.stringify(beforeMedicine.error)).toBeNull();
    expect(beforeMedicine.data!.product_description).toBeNull();

    const firstRun = await service.rpc("run_merdp_descriptive_evidence_backfill", { failure_stage: null });
    expect(firstRun.error, JSON.stringify(firstRun.error)).toBeNull();
    const firstResult = firstRun.data as {
      descriptionsBackfilled: number; storageRowsUpserted: number; refreshRunId: string;
    };
    expect(firstResult.descriptionsBackfilled).toBeGreaterThanOrEqual(1);
    expect(firstResult.storageRowsUpserted).toBeGreaterThanOrEqual(1);

    const afterMedicine = await service.from("medicines")
      .select("product_description, deleted_at").eq("id", medicineId).single();
    expect(afterMedicine.error, JSON.stringify(afterMedicine.error)).toBeNull();
    expect(afterMedicine.data!.product_description).toBe(productDescription);
    expect(afterMedicine.data!.deleted_at).toBeNull();

    const storage = await service.from("medicine_storage_guidance")
      .select("extraction_state, raw_text, source_reference, source_system")
      .eq("medicine_id", medicineId).eq("source_system", "NAFDAC_GREENBOOK").single();
    expect(storage.error, JSON.stringify(storage.error)).toBeNull();
    expect(storage.data).toMatchObject({
      extraction_state: "NEEDS_REVIEW", raw_text: null, source_reference: smpcReference,
    });

    const auditRow = await service.from("merdp_canonical_refresh_runs")
      .select("id, descriptions_backfilled, storage_rows_upserted")
      .eq("id", firstResult.refreshRunId).single();
    expect(auditRow.error, JSON.stringify(auditRow.error)).toBeNull();
    expect(auditRow.data!.id).toBe(firstResult.refreshRunId);

    // Idempotency/replay-safety: source data is unchanged, so the second
    // run must touch zero rows (every write is IS DISTINCT FROM guarded).
    const secondRun = await service.rpc("run_merdp_descriptive_evidence_backfill", { failure_stage: null });
    expect(secondRun.error, JSON.stringify(secondRun.error)).toBeNull();
    const secondResult = secondRun.data as { descriptionsBackfilled: number; storageRowsUpserted: number };
    expect(secondResult.descriptionsBackfilled).toBe(0);
    expect(secondResult.storageRowsUpserted).toBe(0);

    const afterSecondRun = await service.from("medicines")
      .select("product_description").eq("id", medicineId).single();
    expect(afterSecondRun.data!.product_description).toBe(productDescription);
  }, 60_000);

  it("never regresses a manually-reviewed storage row back to a source-only state on re-run", async () => {
    const promoted = await service.from("medicine_storage_guidance")
      .update({
        extraction_state: "SOURCE_STRUCTURED", raw_text: "Store below 30C, do not freeze.",
        winning_source_record_id: (await service.from("etl_source_records")
          .select("id").eq("source_record_id", `descriptive-backfill-fixture-${nonce}`).single()).data!.id,
        reviewed_by: (await service.auth.admin.createUser({
          email: `descriptive-backfill-reviewer-${nonce}@medlink.test`,
          password: `DescriptiveBackfillReviewer-${nonce}-Strong!`, email_confirm: true,
        })).data.user!.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("medicine_id", medicineId).eq("source_system", "NAFDAC_GREENBOOK")
      .select("extraction_state").single();
    expect(promoted.error, JSON.stringify(promoted.error)).toBeNull();
    expect(promoted.data!.extraction_state).toBe("SOURCE_STRUCTURED");

    const rerun = await service.rpc("run_merdp_descriptive_evidence_backfill", { failure_stage: null });
    expect(rerun.error, JSON.stringify(rerun.error)).toBeNull();

    const afterRerun = await service.from("medicine_storage_guidance")
      .select("extraction_state, raw_text").eq("medicine_id", medicineId)
      .eq("source_system", "NAFDAC_GREENBOOK").single();
    expect(afterRerun.error, JSON.stringify(afterRerun.error)).toBeNull();
    expect(afterRerun.data!.extraction_state).toBe("SOURCE_STRUCTURED");
    expect(afterRerun.data!.raw_text).toBe("Store below 30C, do not freeze.");
  }, 60_000);
});
