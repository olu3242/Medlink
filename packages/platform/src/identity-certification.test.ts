import { describe, expect, it } from "vitest";
import { canTransitionTenant, certifyIdentity } from "./identity-certification";

describe("identity and tenant certification", () => {
  const now = new Date("2026-07-30T00:00:00Z");

  it("passes only active owned tenants with current trusted identities", () => {
    const result = certifyIdentity({
      tenantId: "tenant-1",
      lifecycle: "active",
      ownershipVerified: true,
      jwtValidated: true,
      sessionValidated: true,
      requiredIdentityKinds: ["pharmacist", "service_account", "api_client", "device"],
      evaluatedAt: now,
      identities: [
        { subjectId: "p1", kind: "pharmacist", verified: true, trustedClient: true },
        { subjectId: "s1", kind: "service_account", verified: true, trustedClient: true },
        { subjectId: "a1", kind: "api_client", verified: true, trustedClient: true },
        { subjectId: "d1", kind: "device", verified: true, trustedClient: true },
      ],
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects expired, duplicate, or untrusted identity evidence", () => {
    const result = certifyIdentity({
      tenantId: "tenant-1",
      lifecycle: "active",
      ownershipVerified: true,
      jwtValidated: true,
      sessionValidated: true,
      requiredIdentityKinds: ["provider"],
      evaluatedAt: now,
      identities: [
        {
          subjectId: "same",
          kind: "provider",
          verified: true,
          trustedClient: true,
          expiresAt: new Date("2026-07-29T00:00:00Z"),
        },
        { subjectId: "same", kind: "patient", verified: true, trustedClient: false },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("identity");
  });

  it("enforces the tenant activation and suspension workflow", () => {
    expect(canTransitionTenant("provisioning", "active")).toBe(false);
    expect(canTransitionTenant("provisioning", "verified")).toBe(true);
    expect(canTransitionTenant("verified", "active")).toBe(true);
    expect(canTransitionTenant("active", "suspended")).toBe(true);
    expect(canTransitionTenant("suspended", "active")).toBe(true);
  });
});
