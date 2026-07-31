import { describe, expect, it } from "vitest";
import { portalArchitecture, requiredPortals } from "./portal-architecture";

describe("portal architecture", () => {
  it("makes every required RC1 portal professional-facing", () => {
    expect(requiredPortals.length).toBeGreaterThan(0);
    expect(requiredPortals.every((portal) => portal.audience === "professional")).toBe(true);
  });

  it("retains patient web as an optional conversation fallback", () => {
    const patient = portalArchitecture.find((portal) => portal.kind === "patient");
    expect(patient).toMatchObject({ requiredForRc1: false, primaryChannel: "conversation" });
  });
});
