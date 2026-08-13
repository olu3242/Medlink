import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "202607300018_prescription_management.sql",
  ),
  "utf8",
).toLowerCase();

describe("prescription management migration", () => {
  it("extends the canonical prescription tables without duplicating medicine data", () => {
    expect(sql).toContain("alter table public.prescriptions");
    expect(sql).not.toContain("create table public.prescriptions");
    expect(sql).not.toContain("create table public.medicines");
    expect(sql).toContain(
      "where medicine.id = (item_value->>'medicineid')::uuid",
    );
    expect(sql).toContain(
      "medicine.status = 'active'::public.medicine_record_status",
    );
  });

  it("keeps submitted manual prescriptions behind pharmacist review", () => {
    expect(sql).toContain("function public._submit_manual_prescription");
    expect(sql).toContain("'ml-cpp-001'");
    expect(sql).toContain("'ml-wf-005'");
    expect(sql).toContain("'waiting'");
    expect(sql).toContain("'prescription.pharmacist-review.requested.v1'");
    expect(sql).toContain("patient-entered prescription requires independent pharmacist review");
    expect(sql).not.toContain("insert into public.ai_agent_runs");
  });

  it("uses atomic commands, optimistic concurrency, and idempotency", () => {
    for (const command of [
      "create_manual_prescription",
      "update_manual_prescription",
      "delete_manual_prescription_draft",
    ]) {
      expect(sql).toContain(`function public.${command}`);
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${command}\\([\\s\\S]*?\\) to authenticated`,
        ),
      );
    }
    expect(sql).toContain("manual prescription version conflict");
    expect(sql).toContain("contentSha256".toLowerCase());
    expect(sql).toContain("submitted manual prescription is immutable");
  });

  it("exposes only a patient-safe history projection", () => {
    expect(sql).toContain("function public.list_patient_prescriptions");
    expect(sql).toContain("function public.get_patient_prescription");
    expect(sql).toContain("clinical evidence behind pharmacist-only rls");
    expect(sql).not.toMatch(
      /list_patient_prescriptions[\s\S]*?'decisionrationale'/,
    );
    expect(sql).not.toContain("commit;");
  });

  it("keeps prescription events free from clinical text and patient identity", () => {
    const eventPayloads = [
      ...sql.matchAll(
        /'prescription\.[^']+',[\s\S]{0,900}?jsonb_build_object\(([\s\S]{0,600}?)\),[\s\S]{0,200}?target_correlation_id/g,
      ),
    ].map((match) => match[1] ?? "");

    expect(eventPayloads.length).toBeGreaterThanOrEqual(5);
    for (const payload of eventPayloads) {
      expect(payload).not.toMatch(
        /'(patientid|patientname|text|findings|rationale|rawoutput|extraction)'/,
      );
    }
  });
});
