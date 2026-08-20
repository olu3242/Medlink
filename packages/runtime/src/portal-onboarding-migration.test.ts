import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608190075_portal_persona_onboarding.sql"),
  "utf8",
);

describe("production portal persona onboarding migration", () => {
  it("limits public bootstrap to a verified patient identity and the patient role", () => {
    expect(sql).toContain("email_confirmed_at is not null");
    expect(sql).toContain("'patient'::public.member_role");
    expect(sql).toContain("A privileged identity cannot self-enroll as a patient");
    expect(sql).toContain("grant execute on function public.bootstrap_patient_workspace() to authenticated");
  });

  it("keeps pharmacy and pharmacist authority behind Partner governance", () => {
    expect(sql).toContain("Approved pharmacy owner access is required");
    expect(sql).toContain("if not public.is_platform_admin()");
    expect(sql).toContain("application.relationship_status <> 'active'");
    expect(sql).toContain("Self-verification is prohibited");
    expect(sql).toContain("'verified', true");
  });

  it("does not expose privileged onboarding to anonymous callers", () => {
    expect(sql.match(/revoke all on function/g)).toHaveLength(3);
    expect(sql).not.toMatch(/grant execute[\s\S]*to anon;/);
  });
});
