import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/202608250085_access_governance_persistence.sql"), "utf8").toLowerCase();

describe("access-governance persistence migration", () => {
  it.each(["permission_sets", "permission_set_capabilities", "membership_permission_sets", "organization_field_rules", "organization_scope_rules", "test_as_sessions", "access_policy_versions", "access_reviews"])("creates and enables RLS for %s", (table) => {
    expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain(`alter table public.${table} enable row level security`);
  });

  it("hard-denies non-delegable capability persistence", () => {
    for (const capability of ["platform_admin", "cross_tenant_access", "migration_administration", "service_role_operations", "global_security_configuration", "platform_test_as", "global_settlement_administration"]) expect(sql).toContain(capability);
    expect(sql).toContain("raise exception 'capability is non-delegable'");
  });

  it("keeps Test-As metadata token-free and unavailable to anonymous callers", () => {
    expect(sql).not.toMatch(/access_token|refresh_token|raw_token/);
    expect(sql).toContain("revoke all on table public.permission_sets");
    expect(sql).toContain("grant select on table public.test_as_sessions to authenticated");
    expect(sql).not.toContain("grant insert on table public.test_as_sessions to authenticated");
  });

  it("rejects cross-tenant membership, permission-set, pharmacy, and location references", () => {
    expect(sql).toContain("membership is outside organization");
    expect(sql).toContain("permission set is outside organization");
    expect(sql).toContain("pharmacy is outside organization");
    expect(sql).toContain("location is outside organization");
  });
});
