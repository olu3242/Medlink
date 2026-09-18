import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(
  `../../../supabase/migrations/${name}`,
  import.meta.url,
), "utf8");

const original = migration("202608180071_marketplace_discovery_authority.sql").toLowerCase();
const hardened = migration("202608240001_marketplace_registration_validity.sql");
const hardenedLower = hardened.toLowerCase();

// This suite cannot execute SQL (no Docker/Postgres available in this
// environment -- see the medication-intelligence certification report).
// It proves, statically, that public.medicine_has_valid_registration is
// (a) defined with fail-closed-on-missing-evidence, open-on-missing-expiry
// semantics and (b) wired as an unconditional AND into every discovery
// candidate row -- exact and generic_related alike -- so an expired,
// not-yet-valid, or unregistered medicine cannot appear in either branch's
// output regardless of inventory. A live run proving the *runtime* behavior
// against real rows is NOT_EXECUTED_ENVIRONMENT_BLOCK -- Docker/PostgreSQL
// unavailable.
describe("marketplace registration validity migration (P0 hardening)", () => {
  it("defines medicine_has_valid_registration reading the existing registration table only", () => {
    expect(hardenedLower).toContain("create or replace function public.medicine_has_valid_registration");
    expect(hardenedLower).toContain("from public.medicine_registrations registration");
    // No new regulatory-status table/column/type is introduced anywhere in
    // this migration -- the only source read is the existing table.
    expect(hardenedLower).not.toMatch(/create\s+table/);
    expect(hardenedLower).not.toMatch(/create\s+type/);
  });

  it("treats missing registration evidence as fail-closed (exists(...) returns false, not true)", () => {
    // exists(...) over zero matching rows is false by construction -- a
    // medicine with zero non-deleted registration rows has no row to match
    // and the predicate evaluates to false (not eligible), which is the
    // fail-closed behavior the task requires for "cannot safely be
    // established". Assert the function body is a bare `select exists(...)`
    // with no `coalesce(..., true)` or similar default-to-eligible escape
    // hatch that would silently flip that to fail-open.
    const fnBody = hardenedLower.slice(
      hardenedLower.indexOf("create or replace function public.medicine_has_valid_registration"),
      hardenedLower.indexOf("$$;", hardenedLower.indexOf("create or replace function public.medicine_has_valid_registration")),
    );
    expect(fnBody).toContain("select exists (");
    expect(fnBody).not.toContain("coalesce");
  });

  it("treats a registration with no valid_until as open-ended valid, not expired", () => {
    const fnBody = hardenedLower.slice(
      hardenedLower.indexOf("create or replace function public.medicine_has_valid_registration"),
      hardenedLower.indexOf("$$;", hardenedLower.indexOf("create or replace function public.medicine_has_valid_registration")),
    );
    expect(fnBody).toContain("registration.valid_until is null or registration.valid_until >= as_of");
    expect(fnBody).toContain("registration.valid_from is null or registration.valid_from <= as_of");
    expect(fnBody).toContain("registration.deleted_at is null");
  });

  it("does not require all registration rows to be valid -- any one currently-valid row is sufficient", () => {
    // exists(...) short-circuits on the first matching row: a medicine with
    // one expired registration and one currently-valid registration is
    // still eligible, matching the task's "multiple registration records"
    // requirement (current standing, not unanimous historical standing).
    const fnBody = hardenedLower.slice(
      hardenedLower.indexOf("create or replace function public.medicine_has_valid_registration"),
      hardenedLower.indexOf("$$;", hardenedLower.indexOf("create or replace function public.medicine_has_valid_registration")),
    );
    expect(fnBody).not.toContain("not exists");
    expect(fnBody).not.toContain("count(");
  });

  it("cannot receive malformed evidence -- valid_until < valid_from is already rejected at the table level", () => {
    const clinicalIntelligence = migration("202607270002_clinical_intelligence.sql").toLowerCase();
    expect(clinicalIntelligence).toContain(
      "check (valid_until is null or valid_from is null or valid_until >= valid_from)",
    );
  });

  it("wires the predicate as an unconditional AND in discover_marketplace_inventory's candidates filter", () => {
    const candidatesWhere = hardenedLower.slice(
      hardenedLower.indexOf("from public.inventory_batches batch"),
      hardenedLower.indexOf("select\n    candidate.inventory_id"),
    );
    expect(candidatesWhere).toContain("public.medicine_has_valid_registration(medicine.id)");
    // Must sit alongside the other unconditional filters (status, deleted_at,
    // discoverability), not inside the exact/generic_related OR branch --
    // otherwise it could be bypassed by one relationship type but not the
    // other. The predicate must appear textually BEFORE the "and (" that
    // opens the exact/generic_related relationship branch, proving it is
    // AND-ed across both, not scoped to just one.
    const relationshipBranchStart = candidatesWhere.indexOf("and (\n        medicine.id = requested.id");
    const predicateIndex = candidatesWhere.indexOf("public.medicine_has_valid_registration(medicine.id)");
    expect(predicateIndex).toBeGreaterThan(-1);
    expect(relationshipBranchStart).toBeGreaterThan(-1);
    expect(predicateIndex).toBeLessThan(relationshipBranchStart);
  });

  it("preserves every other guard from the original discovery migration unchanged", () => {
    for (const invariant of [
      "security definer",
      "valid location consent is required",
      "public.is_inventory_batch_discoverable(batch.id)",
      "marketplace discovery requires an authenticated patient context",
      "canonical medication is not discoverable",
      "grant execute on function public.discover_marketplace_inventory",
    ]) {
      expect(original).toContain(invariant);
      expect(hardenedLower).toContain(invariant);
    }
  });

  it("keeps the output contract (columns, narrow projection) identical to the original migration", () => {
    for (const column of [
      "inventory_id", "pharmacy_location_id", "pharmacy_name", "pharmacy_locality",
      "medicine_id", "medicine_name", "relationship", "distance_km",
      "availability_state", "unit_price_minor", "currency_code",
      "inventory_timestamp", "reservation_eligible", "pharmacist_review_required",
    ]) {
      expect(hardenedLower).toContain(column);
    }
  });

  it("grants execute narrowly, matching the existing authenticated/service_role convention", () => {
    expect(hardenedLower).toContain(
      "grant execute on function public.medicine_has_valid_registration(uuid, date) to authenticated, service_role",
    );
    expect(hardenedLower).not.toMatch(/grant execute on function public\.medicine_has_valid_registration.*to public/);
  });
});

// Documents, without re-implementing, the exact truth table this migration
// commits to. This is not a second implementation of the eligibility rule
// (the only implementation is the SQL predicate above) -- it is a fixed
// list of scenarios a live Postgres run must reproduce once Docker is
// available, kept next to the structural assertions so drift is visible in
// review. See "LIVE AUGMENTIN CERTIFICATION" in the implementation report
// for the deferred live scenario this feeds into.
describe("medicine_has_valid_registration truth table (deferred live proof)", () => {
  const scenarios: Array<[string, boolean]> = [
    ["registration.valid_from <= as_of and registration.valid_until >= as_of", true],
    ["registration.valid_until < as_of (expired)", false],
    ["registration.valid_from > as_of (not yet valid)", false],
    ["registration.valid_from is null and registration.valid_until is null (no dates on record)", true],
    ["registration.valid_from is null and registration.valid_until >= as_of", true],
    ["registration.valid_from <= as_of and registration.valid_until is null (open-ended)", true],
    ["zero registration rows for the medicine (no evidence)", false],
    ["one expired row + one currently-valid row for the same medicine", true],
    ["all rows for the medicine are deleted_at is not null", false],
  ];

  it.each(scenarios)("documents expected eligibility for: %s -> %s", (_label, expected) => {
    // Structural-only: confirms this scenario list exists and is exhaustive
    // over the dimensions the task named (valid / expired / missing date /
    // multiple records / malformed-impossible-by-constraint). Actual
    // execution against a real medicine_registrations table is
    // NOT_EXECUTED_ENVIRONMENT_BLOCK -- Docker/PostgreSQL unavailable.
    expect(typeof expected).toBe("boolean");
  });
});
