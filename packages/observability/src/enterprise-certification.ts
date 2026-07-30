export type TelemetryDomain =
  | "traces"
  | "metrics"
  | "structured_logs"
  | "workflows"
  | "queues"
  | "ai"
  | "provider_latency"
  | "inventory_latency"
  | "prescription_latency";

export type DashboardScope = "tenant" | "regional" | "operational" | "api";

export interface TelemetryEvidence {
  readonly domain: TelemetryDomain;
  readonly durable: boolean;
  readonly correlated: boolean;
  readonly sampledAt: Date;
}

export function certifyEnterpriseObservability(input: {
  evidence: readonly TelemetryEvidence[];
  dashboards: readonly DashboardScope[];
  evaluatedAt: Date;
  maximumAgeMinutes: number;
}): {
  readonly passed: boolean;
  readonly missingTelemetry: readonly TelemetryDomain[];
  readonly staleTelemetry: readonly TelemetryDomain[];
  readonly missingDashboards: readonly DashboardScope[];
} {
  const requiredTelemetry: readonly TelemetryDomain[] = [
    "traces", "metrics", "structured_logs", "workflows", "queues", "ai",
    "provider_latency", "inventory_latency", "prescription_latency",
  ];
  const requiredDashboards: readonly DashboardScope[] = [
    "tenant", "regional", "operational", "api",
  ];
  const maximumAgeMs = input.maximumAgeMinutes * 60_000;
  const missingTelemetry = requiredTelemetry.filter((domain) =>
    !input.evidence.some((item) =>
      item.domain === domain && item.durable && item.correlated
    ),
  );
  const staleTelemetry = requiredTelemetry.filter((domain) => {
    const samples = input.evidence.filter((item) => item.domain === domain);
    return samples.length > 0 && !samples.some((item) =>
      input.evaluatedAt.getTime() - item.sampledAt.getTime() <= maximumAgeMs
      && item.sampledAt <= input.evaluatedAt
    );
  });
  const missingDashboards = requiredDashboards.filter(
    (scope) => !input.dashboards.includes(scope),
  );
  return {
    passed:
      missingTelemetry.length === 0
      && staleTelemetry.length === 0
      && missingDashboards.length === 0,
    missingTelemetry,
    staleTelemetry,
    missingDashboards,
  };
}
