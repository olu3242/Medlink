import { describe, expect, it } from "vitest";
import { evaluatePlatformEvolution } from "./platform-evolution";

describe("enterprise platform evolution", () => {
  it("keeps a certified framework inactive until RC1 GA", () => {
    const gates = [
      "portfolio_governance", "architecture_integrity", "ai_model_governance",
      "partner_trust", "digital_twin",
    ] as const;
    const result = evaluatePlatformEvolution(gates.map((gate) => ({
      gate, passed: true, evidenceSha256: "d".repeat(64),
    })));
    expect(result.frameworkCertified).toBe(true);
    expect(result.productionActivation).toBe("inactive");
    expect(result.healthcareWorkflowsIntroduced).toBe(false);
  });
});
