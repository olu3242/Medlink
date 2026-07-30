import type { RequestContext } from "./request-context";

export type EnterpriseDashboard =
  | "executive" | "operations" | "clinical_leadership" | "customer_success"
  | "security" | "compliance" | "engineering" | "support";

export interface DashboardMetric {
  readonly tenantId: string;
  readonly dashboard: EnterpriseDashboard;
  readonly name: string;
  readonly current: number;
  readonly history: readonly number[];
  readonly evidenceSha256: string;
}

const platformOnly: ReadonlySet<EnterpriseDashboard> = new Set([
  "executive", "security", "compliance", "engineering",
]);

export function projectEnterpriseDashboard(
  context: RequestContext,
  dashboard: EnterpriseDashboard,
  metrics: readonly DashboardMetric[],
): readonly DashboardMetric[] {
  if (platformOnly.has(dashboard) && context.role !== "platform_admin") {
    throw new Error("Platform administration role required for dashboard");
  }
  return metrics.filter((metric) =>
    metric.dashboard === dashboard
    && (context.role === "platform_admin" || metric.tenantId === context.tenantId)
    && /^[a-f0-9]{64}$/i.test(metric.evidenceSha256)
  );
}
