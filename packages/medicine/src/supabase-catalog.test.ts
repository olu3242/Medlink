import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseCanonicalMedicineRepository } from "./supabase-catalog";

describe("SupabaseCanonicalMedicineRepository list projection", () => {
  it("uses only catalogue summary fields and does not join detail collections", async () => {
    let selected = "";
    const result = {
      data: [{
        id: "02fcafb1-e639-59ca-b7e0-969ac3348f76",
        brand_name: "AC-Ancillin Suspension",
        generic_name: "Ampicillin",
        dosage_form: "suspension",
        route: "oral",
        strength_display: "125 mg/5 mL",
        strength_normalized: "125 mg/5 ml",
        manufacturer_name: "Canonical manufacturer",
        controlled_substance: false,
        status: "active",
        catalog_version: 1,
        created_at: "2026-08-21T00:00:00.000Z",
        updated_at: "2026-08-21T00:00:00.000Z",
      }],
      error: null,
      count: 5429,
    };
    const query = {
      select(columns: string) { selected = columns; return this; },
      is() { return this; },
      order() { return this; },
      limit() { return this; },
      eq() { return this; },
      or() { return this; },
      then(resolve: (value: typeof result) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    const database = { from: () => query } as unknown as SupabaseClient;

    const listed = await new SupabaseCanonicalMedicineRepository(database).list({
      status: "active",
      limit: 10,
    });

    expect(selected).toContain("brand_name");
    expect(selected).not.toContain("medicine_aliases");
    expect(selected).not.toContain("medicine_ingredients");
    expect(selected).not.toContain("medicine_registrations");
    expect(listed.total).toBe(5429);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.brandName).toBe("AC-Ancillin Suspension");
  });
});
