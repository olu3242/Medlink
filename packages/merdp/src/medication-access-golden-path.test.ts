import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/202608140029_medication_access_golden_path.sql",
  "utf8",
);

describe("medication access golden path", () => {
  it("composes the certified canonical lineage instead of raw source identity", () => {
    expect(sql).toContain("certify_merdp_wave1_golden_lineage");
    expect(sql).toContain("canonicalMedicineId");
    expect(sql).not.toContain("medicine_id=source_record_id");
  });

  it("certifies transactional availability and tenant boundaries", () => {
    expect(sql).toContain("search_inventory_availability");
    expect(sql).toContain("outOfStockExcluded");
    expect(sql).toContain("inactiveInventoryExcluded");
    expect(sql).toContain("crossTenantInventoryDenied");
  });

  it("keeps governed exclusions permanent", () => {
    expect(sql).toContain("offListRuntimeExcluded");
    expect(sql).toContain("product9452Excluded");
    expect(sql).toContain("manufacturer1161Safe");
  });
});
