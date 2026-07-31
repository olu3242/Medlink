import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static RLS assertions for Wave 2's tables (docs/audit/RC1_BACKLOG.md P1
// item 7). These verify the migration SQL enables RLS and defines a policy
// for every table each Batch 2.1-2.5 route now writes to
// (apps/admin/lib/application.ts, apps/admin/lib/prescription-extraction.ts).
// They cannot replace a live cross-tenant denial matrix - that requires a
// running PostgreSQL/Supabase instance this sandbox cannot reach (see
// docs/audit/RC1_SPRINT_REPORT.md Phase 1) - but they do fail loudly if a
// future migration edit ever drops RLS or a policy for one of these tables.
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202607270002_clinical_intelligence.sql"),
  "utf8",
).toLowerCase();

const genericsSql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202607290011_generics.sql"),
  "utf8",
).toLowerCase();

describe("wave 2 table RLS", () => {
  const tablesWithPolicies: Record<string, readonly string[]> = {
    medicine_equivalences: ["medicine_equivalences_read", "medicine_equivalences_admin"],
    tenant_equivalence_reviews: [
      "tenant_equivalence_reviews_member_read",
      "tenant_equivalence_reviews_pharmacist_manage",
    ],
    prescription_extractions: [
      "prescription_extractions_clinical_read",
      "prescription_extractions_clinical_manage",
    ],
    prescription_extracted_fields: ["prescription_extracted_fields_clinical"],
    clinical_validations: ["clinical_validations_clinical"],
    clinical_findings: ["clinical_findings_clinical"],
  };

  it.each(Object.entries(tablesWithPolicies))(
    "enables RLS on %s and defines its policies",
    (table, policies) => {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      for (const policy of policies) {
        expect(sql).toContain(`create policy ${policy}`);
      }
    },
  );

  it("scopes tenant_equivalence_reviews writes to the pharmacist role, matching review_medicine_equivalence's re-enforced check", () => {
    const policyStart = sql.indexOf("create policy tenant_equivalence_reviews_pharmacist_manage");
    const policyBody = sql.slice(policyStart, policyStart + 400);
    expect(policyBody).toContain("array['pharmacist']");
  });

  it("scopes clinical_validations and clinical_findings writes to the pharmacist role, matching record_clinical_validation's re-enforced check", () => {
    for (const policy of ["clinical_validations_clinical", "clinical_findings_clinical"]) {
      const policyStart = sql.indexOf(`create policy ${policy}`);
      const policyBody = sql.slice(policyStart, policyStart + 400);
      expect(policyBody).toContain("array['pharmacist']");
    }
  });

  it("scopes prescription_extractions writes to clinical staff, matching record_prescription_extraction's re-enforced check", () => {
    const policyStart = sql.indexOf("create policy prescription_extractions_clinical_manage");
    const policyBody = sql.slice(policyStart, policyStart + 400);
    expect(policyBody).toContain("platform_admin");
    expect(policyBody).toContain("pharmacist");
  });

  it("enables RLS on generics and defines its policies", () => {
    expect(genericsSql).toContain("alter table public.generics enable row level security");
    expect(genericsSql).toContain("create policy generics_read");
    expect(genericsSql).toContain("create policy generics_admin");
  });
});
