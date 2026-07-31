import { describe, expect, it } from "vitest";
import {
  advanceImprovement,
  classifyImprovement,
  type ImprovementItem,
} from "./continuous-improvement";

const item: ImprovementItem = {
  id: "IMP-1",
  tenantId: "tenant-1",
  source: "certification_gap",
  severity: "high",
  tags: ["wave-2.5"],
  stage: "evidence",
  evidenceSha256: "c".repeat(64),
};

describe("continuous improvement", () => {
  it("prioritizes certification gaps over roadmap tags", () => {
    expect(classifyImprovement(item)).toBe("compliance_improvement");
  });

  it("enforces sequential governance and certification before deployment", () => {
    expect(advanceImprovement(item, "analysis").stage).toBe("analysis");
    expect(() => advanceImprovement(
      { ...item, stage: "certification" },
      "deployment",
    )).toThrow(/Certification/);
  });
});
