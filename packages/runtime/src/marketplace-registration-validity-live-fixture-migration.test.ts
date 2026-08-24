import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(new URL(
  "../../../supabase/migrations/202608240003_marketplace_registration_validity_live_fixture.sql",
  import.meta.url,
), "utf8").toLowerCase();

describe("marketplace registration validity live fixture migration", () => {
  it("is service-role-only, matching the established fixture convention", () => {
    expect(fixture).toContain("auth.role() <> 'service_role'");
    expect(fixture).toContain("grant execute on function public.certify_marketplace_registration_validity_fixture(text, uuid)\nto service_role");
    expect(fixture).not.toMatch(/to\s+authenticated/);
  });

  it("covers all six registration scenarios named in the task", () => {
    for (const scenario of [
      "'valid'", "'expired'", "'missing'", "'open_ended'", "'multiple'",
      "generic_requested", "generic_expired",
    ]) {
      expect(fixture).toContain(scenario);
    }
  });

  it("gives the missing-registration medicine zero registration rows (no insert references missing_medicine_id)", () => {
    expect(fixture).not.toContain("missing_medicine_id, 'ng', 'nafdac'");
  });

  it("gives the multiple-registration medicine one expired and one currently-valid row", () => {
    const multiInsert = fixture.slice(
      fixture.indexOf("-- e: multiple registrations"),
      fixture.indexOf("-- f: generic_requested"),
    );
    expect(multiInsert).toContain("current_date - interval '2 years'");
    expect(multiInsert).toContain("current_date + interval '1 year'");
  });

  it("never gives the generic_requested medicine an inventory batch of its own", () => {
    expect(fixture).toContain("needs_inventory");
    expect(fixture).toContain(
      "('generic_requested', generic_requested_medicine_id, 'registration fixture generic requested', false)",
    );
  });

  it("shares generic identity/strength/dosage-form between generic_requested and generic_expired only", () => {
    expect(fixture).toContain("registration-fixture-shared-generic-' || fixture_key");
  });
});
