import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(new URL(
  "../../../supabase/migrations/202608240005_descriptive_evidence_backfill_live_fixture.sql",
  import.meta.url,
), "utf8").toLowerCase();

// Regression fix: CI's live-database job failed with "permission denied for
// table medicines" because public.medicines was never granted to
// service_role. Proves the fix follows the codebase's own established
// pattern (SECURITY DEFINER fixture for writes, narrow SELECT grant for
// reads) rather than widening write access.
describe("descriptive evidence backfill live fixture migration (regression fix)", () => {
  it("grants service_role read-only access to medicines, not write", () => {
    expect(fixture).toContain("grant select on public.medicines to service_role");
    expect(fixture).not.toMatch(/grant\s+(insert|update|delete)\s+on\s+public\.medicines\s+to\s+service_role/);
  });

  it("is service-role-only, matching the established fixture convention", () => {
    expect(fixture).toContain("auth.role() <> 'service_role'");
    expect(fixture).toContain(
      "grant execute on function public.certify_descriptive_evidence_backfill_fixture(text, text, text)\nto service_role",
    );
  });

  it("builds the medicine, ETL evidence chain, and source mapping the backfill RPC reads", () => {
    for (const table of [
      "insert into public.medicines(",
      "insert into public.etl_snapshots(",
      "insert into public.etl_runs(",
      "insert into public.etl_source_records(",
      "insert into public.merdp_source_mappings(",
    ]) {
      expect(fixture).toContain(table);
    }
  });

  it("carries product_description and smpc through raw_payload verbatim", () => {
    expect(fixture).toContain("'product_description', target_product_description, 'smpc', target_smpc_reference");
  });
});
