import { describe, expect, it } from "vitest";
import { authStates, resolveActiveMembership, safeReturnPath } from "./auth-state";
describe("verified workspace and authentication state", () => {
  it("does not infer a role from a selected workspace or portal", () => {
    const memberships = [{ organization_id: "a", role: "patient" }, { organization_id: "b", role: "pharmacist" }];
    expect(resolveActiveMembership(memberships)).toBeUndefined();
    expect(resolveActiveMembership(memberships, "b")?.role).toBe("pharmacist");
    expect(resolveActiveMembership(memberships, "admin")).toBeUndefined();
  });
  it("rejects revoked, suspended and expired memberships", () => {
    for (const invalid of [{ deleted_at: "2026-01-01" }, { suspended_at: "2026-01-01" }, { expires_at: "2020-01-01" }]) {
      expect(resolveActiveMembership([{ organization_id: "a", role: "patient", ...invalid }], "a")).toBeUndefined();
    }
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/%0aevil.test", "/%ZZ"])("rejects unsafe return URL %s", (value) => expect(safeReturnPath(value)).toBe("/"));
  it("preserves internal deep links", () => expect(safeReturnPath("/patient/medicines?q=test")).toBe("/patient/medicines?q=test"));
  it("keeps unresolved and unauthorized states distinct", () => expect(new Set(authStates).size).toBe(6));
});
