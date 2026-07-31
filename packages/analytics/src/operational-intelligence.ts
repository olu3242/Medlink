export type OperationalSignal =
  | "support_trend" | "incident_trend" | "deployment_success"
  | "release_quality" | "provider_availability" | "inventory_stability"
  | "clinical_workflow_performance" | "api_performance" | "ai_utilization"
  | "infrastructure_growth";

export interface OperationalMetric {
  readonly tenantId: string;
  readonly signal: OperationalSignal;
  readonly current: number;
  readonly previous: number;
  readonly target: number;
  readonly higherIsBetter: boolean;
  readonly evidenceSha256: string;
}

export function buildOperationalScorecard(metrics: readonly OperationalMetric[]): {
  readonly score: number;
  readonly regressions: readonly OperationalSignal[];
  readonly forecasts: Readonly<Partial<Record<OperationalSignal, number>>>;
  readonly optimizationOpportunities: readonly string[];
  readonly advisoryOnly: true;
} {
  if (metrics.length === 0) {
    return {
      score: 0,
      regressions: [],
      forecasts: {},
      optimizationOpportunities: ["collect_operational_metrics"],
      advisoryOnly: true,
    };
  }
  const valid = metrics.filter((metric) => /^[a-f0-9]{64}$/i.test(metric.evidenceSha256));
  const regressions = valid
    .filter((metric) =>
      metric.higherIsBetter
        ? metric.current < metric.previous
        : metric.current > metric.previous
    )
    .map((metric) => metric.signal);
  const forecasts = Object.fromEntries(valid.map((metric) => [
    metric.signal,
    Number((metric.current + (metric.current - metric.previous)).toFixed(2)),
  ]));
  const met = valid.filter((metric) =>
    metric.higherIsBetter ? metric.current >= metric.target : metric.current <= metric.target
  ).length;
  return {
    score: Math.round((met / metrics.length) * 100),
    regressions,
    forecasts,
    optimizationOpportunities: regressions.map((signal) => `investigate:${signal}`),
    advisoryOnly: true,
  };
}
