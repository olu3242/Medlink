import { describe, expect, it } from "vitest";
import {
  adviseFromRunbooks,
  transitionRunbook,
  validateRunbook,
  type Runbook,
} from "./runbook-management";

const runbook: Runbook = {
  id: "RB-DEPLOY",
  category: "deployment",
  version: "1.0.0",
  status: "review",
  purpose: "Safely deploy MedLink",
  scope: "Production environments",
  prerequisites: ["Approved release"],
  requiredPermissions: ["release_operator"],
  executionSteps: ["Start canary"],
  expectedResults: ["Healthy canary"],
  validation: ["Run smoke tests"],
  rollback: ["Restore previous release"],
  evidenceRequirements: ["Deployment record"],
  approvalEvidenceSha256: "b".repeat(64),
  revisionHistory: ["Initial review"],
};

describe("runbook management", () => {
  it("approves a complete runbook", () => {
    expect(validateRunbook(runbook)).toEqual([]);
    expect(transitionRunbook(runbook, "approved").status).toBe("approved");
  });

  it("keeps AI guidance advisory", () => {
    const result = adviseFromRunbooks("production deployment", [
      { ...runbook, status: "approved" },
    ]);
    expect(result.recommendations).toEqual(["RB-DEPLOY@1.0.0"]);
    expect(result.privilegedExecutionAllowed).toBe(false);
  });
});
