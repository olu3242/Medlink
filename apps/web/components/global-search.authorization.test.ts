import { describe, expect, it } from "vitest";
import { navigationForRole, personaContractForRole, roles } from "@medlink/platform";

const PORTAL_PREFIX: Record<string, string> = {
  patient: "/patient",
  pharmacist: "/pharmacist",
  provider: "/provider",
  pharmacy: "/pharmacy",
  "pharmacy-manager": "/pharmacy",
  admin: "/admin",
};

describe("global search navigation authorization", () => {
  it("never hands a role's global-search 'Pages' results a route outside its own portal", () => {
    for (const role of roles) {
      const contract = personaContractForRole(role);
      if (!contract) continue;
      const ownPrefix = PORTAL_PREFIX[contract.theme];
      for (const item of navigationForRole(role)) {
        if (item.href === "/") continue; // the shared canonical home route, not a persona leak
        expect(item.href === ownPrefix || item.href.startsWith(`${ownPrefix}/`)).toBe(true);
      }
    }
  });

  it("a patient's global-search navigation results never expose the admin catalog", () => {
    const hrefs = navigationForRole("patient").map((item) => item.href);
    expect(hrefs.some((href) => href.startsWith("/admin"))).toBe(false);
  });

  it("a pharmacist's global-search navigation results never expose the admin catalog", () => {
    const hrefs = navigationForRole("pharmacist").map((item) => item.href);
    expect(hrefs.some((href) => href.startsWith("/admin"))).toBe(false);
  });
});
