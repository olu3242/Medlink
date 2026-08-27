import { describe, expect, it } from "vitest";

import { canAccessPersona } from "./persona-access";

describe("single-app persona route matrix", () => {
  it.each([
    ["admin", "platform_admin", true], ["admin", "tenant_admin", true],
    ["admin", "patient", false], ["patient", "patient", true],
    ["patient", "pharmacist", false], ["pharmacist", "pharmacist", true],
    ["pharmacist", "pharmacy_owner", false], ["pharmacy", "pharmacy_owner", true],
    ["pharmacy", "pharmacy_staff", true], ["pharmacy", "inventory_manager", true],
    ["pharmacy", "patient", false],
  ] as const)("guards %s for %s", (persona, role, expected) => {
    expect(canAccessPersona(persona, [role])).toBe(expected);
  });

  it("fails closed for missing and unknown memberships", () => {
    expect(canAccessPersona("admin", [])).toBe(false);
    expect(canAccessPersona("patient", ["unknown"])).toBe(false);
  });
});
