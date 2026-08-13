import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202607300017_pi1_clinical_pipeline.sql";
const migrationDirectory = join(process.cwd(), "supabase", "migrations");
const sql = readFileSync(
  join(migrationDirectory, migrationName),
  "utf8",
).toLowerCase();

describe("PI-1 clinical pipeline migration", () => {
  it("uses the Supabase pgcrypto extension schema for definition backfill", () => {
    expect(sql).toContain("extensions.digest(\n      convert_to(\n        '{\"capabilityid\":\"ml-cap-006\"");
  });
  it("registers the canonical pipeline and capability ownership", () => {
    expect(sql).toContain("'ml-cpp-001'");
    for (const workflow of [
      "ml-wf-002",
      "ml-wf-003",
      "ml-wf-004",
      "ml-wf-005",
    ]) {
      expect(sql).toContain(`'${workflow}'`);
    }
    expect(sql).toContain(
      `name = 'ml-wf-001'\n  and version = 1`,
    );
    expect(sql).toContain(
      `'{"capabilityid":"ml-cap-006","steps"`,
    );
    expect(sql).toContain(
      `'{"capabilityid":"ml-cap-007","kind":"workflow","stage":"pharmacist_review"`,
    );
  });

  it("keeps PHI in RLS-protected, immutable clinical evidence", () => {
    for (const table of [
      "pharmacist_profiles",
      "prescription_ocr_results",
      "clinical_evidence_packages",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toMatch(
        new RegExp(`create policy [a-z0-9_]+\\s+on public\\.${table}`),
      );
    }
    expect(sql).toContain("prescription_ocr_results_append_only");
    expect(sql).toContain("clinical_evidence_packages_append_only");
    expect(sql).toContain("prescription outbox payload contains prohibited phi");
    expect(sql).toContain(
      `'"(patientid|patientname|text|findings|rationale|rawoutput|extraction)"`,
    );
  });

  it("uses fenced, skip-locked worker claims and service-role-only commands", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("lease_token = new_lease_token");
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("stale or invalid clinical pipeline worker lease");
    for (const command of [
      "claim_clinical_pipeline_stage",
      "complete_clinical_ocr",
      "complete_clinical_parsing",
      "complete_clinical_validation",
      "fail_clinical_pipeline_stage",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${command}\\([\\s\\S]*?\\) to service_role`,
        ),
      );
    }
  });

  it("wraps only OCR and parsing in ARC AI provenance", () => {
    expect(sql).toContain("if claimed_stage in ('ocr', 'parsing') then");
    expect(sql).not.toContain("'clinical_review_assistant'");
    expect(sql).not.toMatch(
      /'stage', 'clinical_validation'[\s\S]{0,500}'ai\.stagecompleted'/,
    );
  });

  it("emits the complete identifier-only clinical event chain", () => {
    for (const eventType of [
      "prescription.ocr.completed.v1",
      "prescription.queued-for-parsing.v1",
      "prescription.parsed.v1",
      "prescription.queued-for-clinical-validation.v1",
      "prescription.clinical-validation.completed.v1",
      "prescription.clinical-packet.generated.v1",
      "prescription.pharmacist-review.requested.v1",
      "prescription.pharmacist-review.completed.v1",
      "prescription.clinically-approved.v1",
      "prescription.clinically-rejected.v1",
      "prescription.clarification-requested.v1",
    ]) {
      expect(sql).toContain(`'${eventType}'`);
    }
    expect(sql).not.toContain("commit;");
  });

  it("centralizes final decisions behind verified pharmacist approval", () => {
    expect(sql).toContain("function public.is_verified_active_pharmacist");
    expect(sql).toContain("function public.decide_prescription_validation");
    expect(sql).toContain("all required clinical findings must be explicitly acknowledged");
    expect(sql).toContain("final prescription clinical state is immutable");
    expect(sql).toContain(
      "final prescription state requires an authorized pharmacist decision",
    );
    expect(sql).toMatch(
      /grant execute on function public\.decide_prescription_validation\([\s\S]*?\) to authenticated/,
    );
  });

  it("does not redeclare an existing trigger name", () => {
    const earlierSql = readdirSync(migrationDirectory)
      .filter((name) => name.endsWith(".sql") && name < migrationName)
      .sort()
      .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
      .join("\n")
      .toLowerCase();
    const priorTriggers = new Set(
      [...earlierSql.matchAll(/create trigger ([a-z0-9_]+)/g)]
        .map((match) => match[1]),
    );
    const currentTriggers = [
      ...sql.matchAll(/create trigger ([a-z0-9_]+)/g),
    ].map((match) => match[1]);

    expect(new Set(currentTriggers).size).toBe(currentTriggers.length);
    expect(currentTriggers.filter((name) => priorTriggers.has(name))).toEqual([]);
  });
});
