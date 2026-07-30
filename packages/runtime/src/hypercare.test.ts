import { describe, expect, it } from "vitest";
import {
  evaluateHypercare,
  type HypercareMetric,
  type HypercareState,
} from "./hypercare";

const metrics: readonly HypercareMetric[] = [
  "api_latency", "prescription_throughput", "inventory_sync",
  "clinical_review_time", "provider_connectivity", "authentication_failures",
  "queue_health", "payment_success", "notification_success", "ai_response",
  "error_rate",
];

const stable: HypercareState = {
  deploymentId: "deploy-1",
  active: true,
  criticalIncidents: 0,
  unresolvedDefects: 0,
  slaMaintained: true,
  certificationRegressions: 0,
  executiveApprovalRecorded: true,
  signals: metrics.map((metric) => ({
    metric,
    healthy: true,
    observedValue: 1,
    threshold: 2,
    evidenceId: `evidence-${metric}`,
  })),
};

describe("hypercare", () => {
  it("exits only when every operational criterion is satisfied", () => {
    expect(evaluateHypercare(stable).canExit).toBe(true);
  });

  it("detects early warnings and blocks exit", () => {
    const signals = stable.signals.map((signal) =>
      signal.metric === "queue_health" ? { ...signal, healthy: false } : signal
    );
    const result = evaluateHypercare({ ...stable, signals });
    expect(result.canExit).toBe(false);
    expect(result.warnings).toContain("early_warning:queue_health");
  });
});
