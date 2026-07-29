import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("transactional runtime migration", () => {
  const sql = readFileSync(join(
    process.cwd(),
    "supabase",
    "migrations",
    "202607270006_transactional_runtime.sql",
  ), "utf8").toLowerCase();

  it("defines durable tenant-scoped evidence and recovery stores", () => {
    for (const table of [
      "runtime_outbox_events",
      "runtime_idempotency_keys",
      "runtime_dead_letters",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("records audit and outbox evidence in one database function", () => {
    expect(sql).toContain("function public.record_runtime_evidence");
    expect(sql).toContain("insert into public.runtime_outbox_events");
    expect(sql).toContain("insert into public.governance_audit_events");
    expect(sql).not.toContain("commit;");
  });
});

describe("use case transactional commit migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607290008_use_case_transactional_commits.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("commits business state and runtime evidence in one function per use case", () => {
    for (const [fn, table] of [
      ["create_medicine_record", "insert into public.medicines"],
      ["update_medicine_record", "update public.medicines"],
      ["create_prescription_record", "insert into public.prescriptions"],
    ] as const) {
      expect(sql).toContain(`function public.${fn}`);
      expect(sql).toContain(table);
    }
    const occurrences = sql.split("public.record_runtime_evidence(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(sql).not.toContain("commit;");
  });

  it("re-enforces the equivalent RLS authorization inside each SECURITY DEFINER function", () => {
    expect(sql).toContain("public.is_platform_admin()");
    expect(sql).toContain("public.is_organization_member(target_organization_id)");
    expect(sql).toContain("public.has_organization_role(");
  });
});

describe("wave 2 batch commit migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607290009_wave2_batch_commits.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("commits business state, child rows, and runtime evidence in one function per use case", () => {
    for (const [fn, tables] of [
      ["review_medicine_equivalence", ["insert into public.tenant_equivalence_reviews"]],
      [
        "record_clinical_validation",
        [
          "insert into public.clinical_validations",
          "insert into public.clinical_findings",
        ],
      ],
      [
        "record_prescription_extraction",
        [
          "insert into public.prescription_extractions",
          "insert into public.prescription_extracted_fields",
          "update public.prescriptions set status = 'needs_review'",
        ],
      ],
    ] as const) {
      expect(sql).toContain(`function public.${fn}`);
      for (const table of tables) expect(sql).toContain(table);
    }
    const occurrences = sql.split("public.record_runtime_evidence(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(sql).not.toContain("commit;");
  });

  it("re-enforces the equivalent RLS authorization inside each SECURITY DEFINER function", () => {
    const occurrences = sql.split("public.has_organization_role(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("array['pharmacist']");
  });
});

describe("runtime evidence repository migration", () => {
  const evidenceSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607280007_runtime_evidence_repository.sql"),
    "utf8",
  );

  it("defines immutable, tenant-scoped, integrity-hashed evidence", () => {
    expect(evidenceSql).toContain("create table public.runtime_evidence_records");
    expect(evidenceSql).toContain("runtime_evidence_append_only");
    expect(evidenceSql).toContain("enable row level security");
    expect(evidenceSql).toContain("integrity_hash");
    expect(evidenceSql).toContain("parent_version_id");
  });
});
