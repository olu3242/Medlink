import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixtureSql = readFileSync(new URL(
  "../../../supabase/migrations/202608170071_pharmacy_catalog_live_fixture.sql",
  import.meta.url,
), "utf8").replace(/\r\n?/g, "\n").toLowerCase();

const aclSql = readFileSync(new URL(
  "../../../supabase/migrations/202608240083_pharmacy_catalog_fixture_execute_acl.sql",
  import.meta.url,
), "utf8").replace(/\r\n?/g, "\n").toLowerCase();

describe("pharmacy catalog certification fixture ACL", () => {
  it("retains the service-role guard inside the fixture", () => {
    expect(fixtureSql).toContain("auth.role() <> 'service_role'");
  });

  it.each(["public", "anon", "authenticated"])(
    "revokes execute authority from %s",
    (role) => {
      expect(aclSql).toContain(
        `revoke all on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid)\n  from ${role};`,
      );
    },
  );

  it("grants execute authority only to service_role", () => {
    expect(aclSql).toContain(
      "grant execute on function public.certify_pharmacy_catalog_fixture(text, uuid, uuid)\n  to service_role;",
    );
    expect(aclSql).not.toMatch(/grant execute[\s\S]*to (?:public|anon|authenticated);/);
  });
});
