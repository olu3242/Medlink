import { describe, expect, it } from "vitest";
import { resolveRoleLanding } from "./role-landing";

describe("unified role landing", () => {
  it.each([
    ["platform_admin", "/admin"],
    ["tenant_admin", "/admin"],
    ["patient", "/patient"],
    ["pharmacist", "/pharmacist"],
    ["pharmacy_owner", "/pharmacy"],
    ["pharmacy_staff", "/pharmacy"],
    ["inventory_manager", "/pharmacy/inventory"],
  ])("routes %s from canonical membership data", (role, destination) => {
    expect(resolveRoleLanding([role])).toBe(destination);
  });

  it("uses deterministic privilege priority and never inspects identity strings", () => {
    expect(resolveRoleLanding(["patient", "platform_admin"])).toBe("/admin");
    expect(resolveRoleLanding(["unknown"])).toBe("/");
  });
});
