import type { RuntimeContext } from "../index";
import type { MetricContext } from "./metric-types";

export function runtimeMetricContext(
  runtime: RuntimeContext,
  input: {
    service: string;
    component: string;
    operation: string;
    environment: string;
  },
): MetricContext {
  return {
    correlationId: runtime.correlationId,
    tenantId: runtime.tenantId,
    organizationId: runtime.organizationId,
    service: input.service,
    component: input.component,
    operation: input.operation,
    environment: input.environment,
  };
}

export function metricContextKey(
  context: MetricContext,
  labels: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({
    ...context,
    labels: Object.fromEntries(Object.entries(labels).sort(([a], [b]) =>
      a.localeCompare(b))),
  });
}
