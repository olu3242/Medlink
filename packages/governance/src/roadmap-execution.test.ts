import { describe, expect, it } from "vitest";
import { advanceInitiative, type RoadmapInitiative } from "./roadmap-execution";

const initiative: RoadmapInitiative = {
  id: "INIT-1",
  waveId: "wave-2.5",
  businessObjective: "Improve partner connectivity",
  dependencies: ["extension-framework"],
  riskAssessment: ["provider availability"],
  status: "certification",
  certificationRequirements: ["security", "provider", "operations"],
  rolloutStrategy: "canary",
  successMetrics: ["availability"],
};

describe("roadmap execution", () => {
  it("cannot roll out an uncertified initiative", () => {
    expect(() => advanceInitiative(initiative, "rollout")).toThrow(/certification/);
  });

  it("allows rollout only with certification evidence", () => {
    expect(advanceInitiative({
      ...initiative,
      certificationEvidenceSha256: "f".repeat(64),
    }, "rollout").status).toBe("rollout");
  });
});
