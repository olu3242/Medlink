export interface MetricContext {
  correlationId: string;
  tenantId: string;
  organizationId: string;
  service: string;
  component: string;
  operation: string;
  environment: string;
}

export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricPoint {
  name: string;
  kind: "counter" | "gauge" | "histogram";
  context: MetricContext;
  labels: MetricLabels;
  value: number;
  observedAt: string;
}

export interface MetricSink {
  record(point: MetricPoint): void | Promise<void>;
}

export interface HistogramSnapshot {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Readonly<Record<string, number>>;
}
