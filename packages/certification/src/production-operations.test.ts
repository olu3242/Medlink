import { describe, expect, it } from "vitest";
import { evaluateProductionOperations } from "./production-operations";

describe("production operations admission", () => {
  it("fails closed when an operational engine lacks evidence", () => {
    const result = evaluateProductionOperations({
      status: "completed",
      blockers: [],
      certificationUpdate: "pass",
      dashboard: {
        currentRelease: "rc1",
        previousRelease: "rc0",
        environmentStatus: "healthy",
        deploymentHealth: "healthy",
      },
    }, [{
      engine: "deployment",
      passed: true,
      evidenceSha256: "a".repeat(64),
    }]);
    expect(result.operationallyReady).toBe(false);
    expect(result.releaseCompletionNotificationAllowed).toBe(false);
  });
});
