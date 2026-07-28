import { metricContextKey } from "./metric-context";
import type { MetricContext, MetricLabels, MetricSink } from "./metric-types";

export class Gauge {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    private readonly sink?: MetricSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  set(context: MetricContext, value: number, labels: MetricLabels = {}): number {
    if (!Number.isFinite(value)) throw new Error("Gauge values must be finite");
    this.values.set(metricContextKey(context, labels), value);
    void this.sink?.record({
      name: this.name,
      kind: "gauge",
      context,
      labels,
      value,
      observedAt: this.now().toISOString(),
    });
    return value;
  }

  add(context: MetricContext, amount: number, labels: MetricLabels = {}): number {
    return this.set(context, this.value(context, labels) + amount, labels);
  }

  value(context: MetricContext, labels: MetricLabels = {}): number {
    return this.values.get(metricContextKey(context, labels)) ?? 0;
  }

  total(): number {
    return [...this.values.values()].reduce((sum, value) => sum + value, 0);
  }
}
