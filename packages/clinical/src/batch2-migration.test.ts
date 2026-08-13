import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "202607310021_batch2_review_inventory_integration.sql",
  ),
  "utf8",
).toLowerCase();

describe("Batch 2 clinical and inventory integration migration", () => {
  it("keeps medicine resolution human-owned and append-only", () => {
    expect(sql).toContain("create table public.clinical_review_items");
    expect(sql).toContain("clinical_review_items_append_only");
    expect(sql).toContain("public.is_verified_active_pharmacist");
    expect(sql).toContain("approval requires every prescription item to be resolved");
    expect(sql).toContain("reviewed medicine is not active in the catalogue");
    expect(sql).not.toContain("insert into public.ai_agent_runs");
  });

  it("closes the legacy decision bypass and exposes one atomic command", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.decide_prescription_validation\([\s\S]*?from authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.decide_prescription_validation_with_resolution\([\s\S]*?to authenticated/,
    );
    expect(sql).toContain("review resolution idempotency conflict");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("preserves the needs-information round trip and requeues review", () => {
    expect(sql).toContain("create table public.prescription_clarifications");
    expect(sql).toContain("function public.respond_prescription_clarification");
    expect(sql).toContain("only the prescription patient may respond");
    expect(sql).toContain("workflow.human-review.requeued.v1");
    expect(sql).toContain("prescription.clarification-responded.v1");
    expect(sql).toContain("response_sha256");
    expect(sql).toContain("clarification response idempotency conflict");
    expect(sql).toContain("patient clarification received; independent pharmacist re-review required");
  });

  it("never places clarification or medicine content in outbox payloads", () => {
    const inserts = [...sql.matchAll(
      /insert into public\.runtime_outbox_events[\s\S]*?;\s*/g,
    )].map((match) => match[0]);
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const insert of inserts) {
      expect(insert).not.toContain("target_response_text");
      expect(insert).not.toContain("response_text");
      expect(insert).not.toContain("request_text");
      expect(insert).not.toContain("target_rationale");
    }
  });

  it("uses RLS and has no embedded transaction boundary", () => {
    expect(sql).toContain(
      "alter table public.prescription_clarifications enable row level security",
    );
    expect(sql).toContain(
      "prescription_clarifications_participant_read",
    );
    expect(sql).not.toContain("commit;");
  });
});
