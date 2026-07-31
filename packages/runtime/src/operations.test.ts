import { describe, expect, it } from "vitest";
import { evaluateSlo, operationalAlerts } from "./operations";

describe("runtime operations", () => {
  it("calculates an availability error budget", () => {
    const result = evaluateSlo({
      id: "api-availability",
      indicator: "availability",
      target: 0.99,
      windowMinutes: 30,
    }, [{ good: 995, total: 1000, observedAt: new Date() }]);
    expect(result.met).toBe(true);
    expect(result.errorBudgetRemaining).toBeCloseTo(0.5);
  });

  it("alerts on SLO, dependency, queue, and dead-letter failures", () => {
    const alerts = operationalAlerts({
      evaluation: {
        objectiveId: "api",
        value: 0.9,
        target: 0.99,
        met: false,
        errorBudgetRemaining: 0,
      },
      unhealthyDependencies: ["database"],
      queueDepth: 101,
      oldestQueuedSeconds: 301,
      deadLetterDepth: 1,
    });
    expect(alerts.map((alert) => alert.key)).toEqual([
      "slo:api",
      "dependency:database",
      "queue:backlog",
      "queue:dead-letter",
    ]);
  });
});
