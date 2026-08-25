import { describe, expect, it } from "vitest";
import { authorizeTestAsRequest, personaCertificationMatrix, testAsRequestSchema } from "./persona-certification";

describe("persona certification contracts", () => {
  it("defines every canonical MedLink role exactly once", () => {
    expect(personaCertificationMatrix.map(({ role }) => role).sort()).toEqual([
      "inventory_manager", "patient", "pharmacist", "pharmacy_owner",
      "pharmacy_staff", "platform_admin", "provider", "tenant_admin",
    ]);
    expect(new Set(personaCertificationMatrix.map(({ emailEnv }) => emailEnv)).size).toBe(8);
  });

  it("rejects platform-admin targets and browser role tampering", () => {
    const base = { targetSubjectId: crypto.randomUUID(), targetMembershipId: crypto.randomUUID(), targetTenantId: crypto.randomUUID(), purpose: "catalog_certification" };
    expect(testAsRequestSchema.safeParse({ ...base, targetRole: "platform_admin" }).success).toBe(false);
    expect(testAsRequestSchema.safeParse({ ...base, targetRole: "super_admin" }).success).toBe(false);
    expect(testAsRequestSchema.safeParse({ ...base, targetRole: "patient" }).success).toBe(true);
  });

  it("denies non-admin, nested, expired, and overlong sessions", () => {
    const now = new Date("2026-08-25T00:00:00Z");
    expect(() => authorizeTestAsRequest({ userId: crypto.randomUUID(), role: "patient" }, new Date(now.getTime() + 60_000), now)).toThrow(/administrator/);
    expect(() => authorizeTestAsRequest({ userId: crypto.randomUUID(), role: "platform_admin", activeTestAsSessionId: crypto.randomUUID() }, new Date(now.getTime() + 60_000), now)).toThrow(/Nested/);
    expect(() => authorizeTestAsRequest({ userId: crypto.randomUUID(), role: "platform_admin" }, now, now)).toThrow(/expiry/);
    expect(() => authorizeTestAsRequest({ userId: crypto.randomUUID(), role: "platform_admin" }, new Date(now.getTime() + 16 * 60_000), now)).toThrow(/15 minutes/);
    expect(() => authorizeTestAsRequest({ userId: crypto.randomUUID(), role: "platform_admin" }, new Date(now.getTime() + 15 * 60_000), now)).not.toThrow();
  });
});
