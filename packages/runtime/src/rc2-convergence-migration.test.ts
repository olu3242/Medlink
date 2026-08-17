import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170045_mar_validation_review_handoff.sql",
), "utf8").toLowerCase();

describe("RC2 MAR validation to clinical review handoff", () => {
  it("creates the pending review and evidence in the validating transaction", () => {
    expect(sql).toContain("function public.validate_mar");
    expect(sql).toContain("insert into public.clinical_reviews");
    expect(sql).toContain("updated.prescription_id");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("retains actor, role, tenant, state, and concurrency guards", () => {
    expect(sql).toContain("target_actor_id is distinct from auth.uid()");
    expect(sql).toContain("array['pharmacist', 'pharmacy_staff']::public.member_role[]");
    expect(sql).toContain("organization_id = target_organization_id");
    expect(sql).toContain("and state = 'created'");
    expect(sql).toContain("on conflict (organization_id, idempotency_key)");
  });
});
