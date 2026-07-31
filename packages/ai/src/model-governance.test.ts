import { describe, expect, it } from "vitest";
import { evaluateModelGovernance } from "./model-governance";

describe("enterprise AI governance", () => {
  it("blocks uncertified models and triggers rollback on monitored drift", () => {
    const result = evaluateModelGovernance({
      id: "model-1", modelVersion: "1.0.0", provider: "provider",
      promptVersion: "1.0.0", evaluationDatasetVersion: "1",
      lifecycle: "monitoring", approvalHistory: ["approved"],
      deploymentHistory: ["deploy-1"], rollbackHistory: [],
      certificationEvidenceSha256: "a".repeat(64),
    }, {
      accuracy: 0.7, drift: 0.2, latencyMs: 100, cost: 1,
      hallucinationReports: 1, overrideRate: 0.1, userFeedback: 0.9,
      confidenceCalibration: 0.9,
    });
    expect(result.deployable).toBe(false);
    expect(result.rollbackRequired).toBe(true);
  });
});
