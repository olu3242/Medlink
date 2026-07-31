import { describe, expect, it } from "vitest";
import {
  certifyEnterpriseObservability,
  type TelemetryDomain,
} from "./enterprise-certification";

describe("enterprise observability certification", () => {
  const domains: readonly TelemetryDomain[] = [
    "traces", "metrics", "structured_logs", "workflows", "queues", "ai",
    "provider_latency", "inventory_latency", "prescription_latency",
  ];
  const now = new Date("2026-07-30T00:00:00Z");

  it("requires fresh durable correlated telemetry and every dashboard", () => {
    const result = certifyEnterpriseObservability({
      evidence: domains.map((domain) => ({
        domain,
        durable: true,
        correlated: true,
        sampledAt: new Date("2026-07-29T23:59:00Z"),
      })),
      dashboards: ["tenant", "regional", "operational", "api"],
      evaluatedAt: now,
      maximumAgeMinutes: 5,
    });
    expect(result.passed).toBe(true);
  });

  it("reports missing, stale, and uncorrelated coverage", () => {
    const result = certifyEnterpriseObservability({
      evidence: [{
        domain: "traces",
        durable: true,
        correlated: true,
        sampledAt: new Date("2026-07-29T22:00:00Z"),
      }],
      dashboards: ["api"],
      evaluatedAt: now,
      maximumAgeMinutes: 5,
    });
    expect(result.passed).toBe(false);
    expect(result.staleTelemetry).toEqual(["traces"]);
    expect(result.missingTelemetry).toContain("metrics");
    expect(result.missingDashboards).toContain("tenant");
  });
});
