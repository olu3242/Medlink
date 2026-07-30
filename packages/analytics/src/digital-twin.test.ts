import { describe, expect, it } from "vitest";
import { simulateEnterpriseScenario } from "./digital-twin";

describe("digital twin", () => {
  it("produces advisory forecasts without production mutation authority", () => {
    const result = simulateEnterpriseScenario({
      id: "scenario-1", dimensions: ["wave_rollout"],
      baseline: { capacity: 100 }, changes: { capacity: 20 },
      modelVersion: "1.0.0", evidenceSha256: "c".repeat(64),
    });
    expect(result.forecast.capacity).toBe(120);
    expect(result.productionMutationAllowed).toBe(false);
  });
});
