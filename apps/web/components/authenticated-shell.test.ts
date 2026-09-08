import { describe, expect, it } from "vitest";
import { personaContractForRole } from "@medlink/platform";

describe("authenticated persona shell contract", () => {
  it.each([
    ["platform_admin", "admin", "Platform Administrator"],
    ["patient", "patient", "Patient"],
    ["pharmacist", "pharmacist", "Pharmacist"],
    ["pharmacy_owner", "pharmacy-manager", "Pharmacy Owner"],
  ] as const)("resolves %s from the database role", (role, theme, label) => {
    const contract = personaContractForRole(role);
    expect(contract?.theme).toBe(theme);
    expect(contract?.roleLabel).toBe(label);
  });

  it("does not provide a cosmetic test-as persona", () => {
    expect(personaContractForRole("platform_admin")?.role).toBe("platform_admin");
    expect(personaContractForRole("patient")?.role).toBe("patient");
  });
});