import { describe, expect, it } from "vitest";
import {
  evaluateContinuity,
  type ContinuityDomain,
  type ContinuityExercise,
} from "./business-continuity";

const domains: readonly ContinuityDomain[] = [
  "infrastructure", "database", "messaging", "payments", "ai", "identity",
  "clinical_operations", "inventory", "pharmacy_network", "communications",
  "support_operations",
];

const exercise: ContinuityExercise = {
  id: "BC-1",
  scenario: "region_failure",
  controlled: true,
  executedAt: new Date("2026-07-30T00:00:00Z"),
  recoveredInMinutes: 20,
  dataLossMinutes: 2,
  validationPassed: true,
  evidenceSha256: "c".repeat(64),
  domainChecks: Object.fromEntries(
    domains.map((domain) => [domain, true]),
  ) as Record<ContinuityDomain, boolean>,
};

describe("business continuity", () => {
  it("certifies evidence-backed recovery within objectives", () => {
    const result = evaluateContinuity(exercise, [{
      domain: "infrastructure",
      rtoMinutes: 30,
      rpoMinutes: 5,
      maximumTolerableDowntimeMinutes: 60,
    }]);
    expect(result.status).toBe("ready");
    expect(result.score).toBe(100);
  });

  it("degrades when a recovery objective is missed", () => {
    const result = evaluateContinuity(exercise, [{
      domain: "database",
      rtoMinutes: 10,
      rpoMinutes: 1,
      maximumTolerableDowntimeMinutes: 15,
    }]);
    expect(result.status).toBe("degraded");
    expect(result.blockers).toContain("rto_missed:database");
  });
});
