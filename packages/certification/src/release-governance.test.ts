import { describe, expect, it } from "vitest";
import {
  evaluateRelease,
  nextReleaseStage,
  type MandatoryReleaseGate,
} from "./release-governance";

describe("enterprise release governance", () => {
  const gates: readonly MandatoryReleaseGate[] = [
    "runtime", "live_database", "hosted_rls", "migration", "security",
    "observability", "clinical", "compliance", "backup",
    "disaster_recovery", "human_approval",
  ];

  it("allows production progression only with every immutable gate", () => {
    expect(evaluateRelease({
      stage: "production_approval",
      type: "standard",
      frozen: false,
      withinMaintenanceWindow: true,
      rollbackApproved: true,
      gates: gates.map((gate) => ({
        gate,
        passed: true,
        evidenceSha256: "a".repeat(64),
      })),
    })).toEqual({ allowed: true, blockers: [] });
    expect(nextReleaseStage("deployment")).toBe("post_deployment_validation");
  });

  it("does not let emergency releases bypass mandatory certification", () => {
    const result = evaluateRelease({
      stage: "production_approval",
      type: "emergency",
      frozen: true,
      withinMaintenanceWindow: false,
      rollbackApproved: false,
      gates: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("rollback_not_approved");
    expect(result.blockers).toContain("gate_failed:security");
  });
});
