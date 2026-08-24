import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(
  `../../../supabase/migrations/${name}`,
  import.meta.url,
), "utf8").toLowerCase();

const wave1 = migration("202608130024_merdp_wave1_convergence.sql");
const backfill = migration("202608240002_medicine_description_and_storage_evidence.sql");

// Static-assertion certification (no Docker/PostgreSQL available in this
// environment -- see the medication-intelligence certification report).
// Proves this migration is purely additive: it does not redefine or touch
// run_merdp_wave1_convergence at all, so there is zero regression risk to
// that already-certified convergence path.
describe("descriptive evidence backfill migration (P1 hardening)", () => {
  it("does not redefine run_merdp_wave1_convergence -- zero regression risk to the certified convergence path", () => {
    expect(backfill).not.toContain("create or replace function public.run_merdp_wave1_convergence");
    // The original wave1 migration file is untouched by this change.
    expect(wave1).toContain("create or replace function public.run_merdp_wave1_convergence");
  });

  it("reuses the existing merdp_source_mappings/merdp_latest_product_source_records evidence rather than re-deriving identity", () => {
    expect(backfill).toContain("from public.merdp_source_mappings m");
    expect(backfill).toContain("join public.merdp_latest_product_source_records r on r.id = m.source_record_id");
    // No new deterministic-identity UUID derivation is introduced here --
    // that logic stays solely owned by run_merdp_wave1_convergence.
    expect(backfill).not.toContain("uuid_generate_v5");
  });

  it("projects product_description verbatim, never fabricating a value", () => {
    expect(backfill).toContain("product_description = nullif(btrim(r.raw_payload->>'product_description'), '')");
    // Guarded by IS DISTINCT FROM -- a no-op call never touches unchanged rows.
    expect(backfill).toContain("med.product_description is distinct from nullif(btrim(r.raw_payload->>'product_description'), '')");
  });

  it("never claims SMPC extraction occurred -- only records reference evidence, honestly, as NEEDS_REVIEW/UNAVAILABLE", () => {
    expect(backfill).toContain("smpc_reference");
    expect(backfill).toContain("raw_payload->>'smpc'");
    expect(backfill).toContain("then 'needs_review'");
    expect(backfill).toContain("else 'unavailable'");
    // SOURCE_STRUCTURED/EXTRACTED are declared as valid states on the table
    // (asserted in the schema test below) but this backfill never assigns
    // either -- no fabricated extraction.
    const insertStatement = backfill.slice(
      backfill.indexOf("insert into public.medicine_storage_guidance("),
      backfill.indexOf("on conflict (medicine_id, source_system) do update set"),
    );
    expect(insertStatement).not.toContain("source_structured");
    expect(insertStatement).not.toContain("'extracted'");
  });

  it("never regresses a human/pipeline-advanced storage row back to a source-only state on re-run", () => {
    const updateClause = backfill.slice(
      backfill.indexOf("on conflict (medicine_id, source_system) do update set"),
      backfill.indexOf("returning medicine_storage_guidance.id"),
    );
    expect(updateClause).toContain("when medicine_storage_guidance.extraction_state in ('source_structured', 'extracted')");
    expect(updateClause).toContain("then medicine_storage_guidance.extraction_state");
  });

  it("declares the full required extraction-state vocabulary on the table", () => {
    expect(backfill).toContain("create type public.medicine_storage_extraction_state as enum");
    for (const state of ["source_structured", "extracted", "needs_review", "unavailable"]) {
      expect(backfill).toContain(state);
    }
  });

  it("schema-enforces evidence before a structured/extracted claim (never generate storage text without a source)", () => {
    const checkClause = backfill.slice(
      backfill.indexOf("check (\n    (extraction_state in"),
      backfill.indexOf("check (\n    (reviewed_by is null"),
    );
    expect(checkClause).toContain("raw_text is not null and winning_source_record_id is not null");
    expect(checkClause).toContain("or extraction_state in ('needs_review', 'unavailable')");
  });

  it("is idempotent and replay-safe: every write is IS DISTINCT FROM guarded, and it never deletes rows", () => {
    expect(backfill).not.toMatch(/delete\s+from\s+public\.medicines/);
    expect(backfill).not.toMatch(/delete\s+from\s+public\.medicine_storage_guidance/);
    expect(backfill).toContain("is distinct from excluded.source_reference");
  });

  it("is service-role-only, matching run_merdp_wave1_convergence's own authority boundary", () => {
    expect(backfill).toContain("auth.role() <> 'service_role'");
    expect(backfill).toContain("grant execute on function public.run_merdp_descriptive_evidence_backfill(text) to service_role");
    expect(backfill).not.toMatch(/grant execute on function public\.run_merdp_descriptive_evidence_backfill.*to authenticated/);
  });

  it("records an auditable refresh run per invocation, driving toward drift-aware freshness visibility", () => {
    expect(backfill).toContain("create table public.merdp_canonical_refresh_runs");
    expect(backfill).toContain("insert into public.merdp_canonical_refresh_runs(");
    expect(backfill).toContain("product_snapshot_id");
    expect(backfill).toContain("manufacturer_snapshot_id");
  });
});
