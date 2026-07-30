import { describe, expect, it } from "vitest";
import { authorizeWave, validateWave, type GovernedWave } from "./wave-governance";

const wave: GovernedWave = {
  id: "wave-2.5",
  name: "Future expansion",
  version: "1.0.0",
  ownerId: "product-owner",
  dependencies: ["rc1-ga"],
  admissionStatus: "eligible",
  admissionCriteria: ["RC1 GA"],
  exitCriteria: ["Wave certification"],
  certificationRequirements: ["security", "clinical", "operations"],
  changeHistory: ["proposed"],
};

describe("wave governance", () => {
  it("validates governed wave metadata", () => {
    expect(validateWave(wave)).toEqual([]);
  });

  it("cannot authorize Wave 2.5 without real evidence and approval", () => {
    expect(() => authorizeWave(wave)).toThrow(/Operational certification/);
    expect(authorizeWave({
      ...wave,
      operationalCertificationEvidenceSha256: "a".repeat(64),
      executiveApprovalEvidenceSha256: "b".repeat(64),
    }).admissionStatus).toBe("authorized");
  });
});
