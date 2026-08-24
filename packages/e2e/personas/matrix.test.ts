import { describe, expect, it } from "vitest";
import { memberRoles, personaMatrix } from "./matrix";

describe("production persona matrix", () => {
  it("uses only canonical database membership roles", () => {
    for (const persona of Object.values(personaMatrix)) {
      if (persona.membershipRole) expect(memberRoles).toContain(persona.membershipRole);
    }
  });

  it("does not grant partner applicants a privileged membership", () => {
    expect(personaMatrix.partner_applicant.membershipRole).toBeNull();
    expect(personaMatrix.partner_applicant.forbiddenWorkflows).toContain("self_approval");
  });

  it("records capability gaps instead of inventing coverage", () => {
    expect(personaMatrix.provider.implementation).toBe("foundation_only");
    expect(personaMatrix.inventory_manager.implementation).toBe("foundation_only");
  });
});
