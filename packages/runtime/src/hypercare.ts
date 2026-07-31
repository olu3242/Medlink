export type HypercareMetric =
  | "api_latency" | "prescription_throughput" | "inventory_sync"
  | "clinical_review_time" | "provider_connectivity" | "authentication_failures"
  | "queue_health" | "payment_success" | "notification_success" | "ai_response"
  | "error_rate";

export interface HypercareSignal {
  readonly metric: HypercareMetric;
  readonly healthy: boolean;
  readonly observedValue: number;
  readonly threshold: number;
  readonly evidenceId: string;
}

export interface HypercareState {
  readonly deploymentId: string;
  readonly active: boolean;
  readonly criticalIncidents: number;
  readonly unresolvedDefects: number;
  readonly slaMaintained: boolean;
  readonly certificationRegressions: number;
  readonly executiveApprovalRecorded: boolean;
  readonly signals: readonly HypercareSignal[];
}

export function evaluateHypercare(state: HypercareState): {
  readonly canExit: boolean;
  readonly warnings: readonly string[];
  readonly dashboard: Readonly<Record<HypercareMetric, "healthy" | "warning" | "missing">>;
} {
  const metrics: readonly HypercareMetric[] = [
    "api_latency", "prescription_throughput", "inventory_sync",
    "clinical_review_time", "provider_connectivity", "authentication_failures",
    "queue_health", "payment_success", "notification_success", "ai_response",
    "error_rate",
  ];
  const warnings: string[] = [];
  if (state.criticalIncidents > 0) warnings.push("critical_incidents_open");
  if (state.unresolvedDefects > 0) warnings.push("production_defects_open");
  if (!state.slaMaintained) warnings.push("sla_not_maintained");
  if (state.certificationRegressions > 0) warnings.push("certification_regression");
  if (!state.executiveApprovalRecorded) warnings.push("executive_approval_missing");
  for (const signal of state.signals) {
    if (!signal.healthy || signal.evidenceId.trim() === "") {
      warnings.push(`early_warning:${signal.metric}`);
    }
  }
  const dashboard = Object.fromEntries(metrics.map((metric) => {
    const signal = state.signals.find((item) => item.metric === metric);
    return [metric, !signal ? "missing" : signal.healthy ? "healthy" : "warning"];
  })) as Record<HypercareMetric, "healthy" | "warning" | "missing">;
  const complete = metrics.every((metric) => dashboard[metric] === "healthy");
  return { canExit: state.active && complete && warnings.length === 0, warnings, dashboard };
}
