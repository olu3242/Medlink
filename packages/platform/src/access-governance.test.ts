import { describe, expect, it } from "vitest";
import { authorizeTestAsSession, resolveEffectiveAccess, validateDelegatedCapabilities } from "./access-governance";
import { permissions } from "./roles";

describe("persisted access-governance policy", () => {
  it.each(["tenant_admin", "pharmacy_owner", "inventory_manager"] as const)("denies %s non-delegable assignment", (role) => {
    expect(() => validateDelegatedCapabilities(role, ["platform_admin", "cross_tenant_access"])).toThrow(/Non-delegable/);
  });

  it("prevents permission sets and organization rules from widening the platform/role maximum", () => {
    const result = resolveEffectiveAccess({
      role: "inventory_manager",
      platformMaximum: permissions,
      organizationDenied: ["inventory:manage"],
      permissionSets: [{ capabilities: ["inventory:read", "inventory:manage", "payment:read"] }],
      platformFieldAccess: { unitCost: "read_only", quantity: "editable" },
      organizationFieldAccess: { unitCost: "editable", quantity: "read_only" },
      roleFieldAccess: { unitCost: "editable", quantity: "editable" },
      scope: "own_location",
    });
    expect(result.decision).toBe("allow");
    expect(result.capabilities).toEqual(["inventory:read"]);
    expect(result.fieldAccess).toEqual({ unitCost: "read_only", quantity: "read_only" });
    expect(result.scope).toBe("own_location");
  });

  it("fails closed when record/RLS authorization denies access", () => {
    expect(resolveEffectiveAccess({ role: "tenant_admin", platformMaximum: permissions, recordAllowed: false })).toMatchObject({ decision: "deny", reasons: ["record_policy_denied"] });
  });

  it("never creates a cosmetic Test-As authorization context", () => {
    expect(() => authorizeTestAsSession({ actorId: crypto.randomUUID(), subjectId: crypto.randomUUID(), tenantId: crypto.randomUUID(), membershipId: crypto.randomUUID(), expiresAt: "2099-01-01T00:00:00Z", status: "active" })).toThrow(/BLOCKED_BY_ARCHITECTURE/);
  });
});
