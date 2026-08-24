import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(
  `../../../supabase/migrations/${name}`,
  import.meta.url,
), "utf8").toLowerCase();

const fix = migration("202608240004_discovery_fixture_registration_evidence.sql");

// Regression fix: CI's medication-golden-loop-e2e job failed on
// 202608240001 because the golden-loop and WhatsApp discovery fixtures
// never gave their medicines a medicine_registrations row -- once
// discover_marketplace_inventory required one, both fixtures' medicines
// correctly stopped being discoverable, turning the E2E's expected
// BOTH_AVAILABLE into NONE_AVAILABLE. This is a fixture realism fix, not a
// change to the registration-validity predicate itself.
describe("discovery fixture registration evidence migration (regression fix)", () => {
  it("gives the golden-loop fixture medicine a currently-valid registration", () => {
    const fnBody = fix.slice(
      fix.indexOf("create or replace function public.certify_medication_golden_loop_fixture"),
      fix.indexOf("create or replace function public.certify_whatsapp_discovery_golden_fixture"),
    );
    expect(fnBody).toContain("insert into public.medicine_registrations(");
    expect(fnBody).toContain("current_date - interval '1 year', current_date + interval '1 year'");
  });

  it("gives the WhatsApp discovery generic-equivalent fixture medicine a currently-valid registration", () => {
    const fnBody = fix.slice(
      fix.indexOf("create or replace function public.certify_whatsapp_discovery_golden_fixture"),
    );
    expect(fnBody).toContain("insert into public.medicine_registrations(");
    expect(fnBody).toContain("generic_medicine_id, 'ng', 'nafdac'");
  });

  it("does not touch discover_marketplace_inventory or medicine_has_valid_registration themselves", () => {
    expect(fix).not.toContain("create or replace function public.discover_marketplace_inventory");
    expect(fix).not.toContain("create or replace function public.medicine_has_valid_registration");
  });
});
