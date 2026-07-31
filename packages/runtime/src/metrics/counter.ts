import { metricContextKey } from "./metric-context";
import type { MetricContext, MetricLabels, MetricSink } from "./metric-types";

export class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    private readonly sink?: MetricSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  increment(
    context: MetricContext,
    amount = 1,
    labels: MetricLabels = {},
  ): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Counter increments must be finite and non-negative");
    }
    const key = metricContextKey(context, labels);
    const value = (this.values.get(key) ?? 0) + amount;
    this.values.set(key, value);
    void this.sink?.record({
      name: this.name,
      kind: "counter",
      context,
      labels,
      value,
      observedAt: this.now().toISOString(),
    });
    return value;
  }

  value(context: MetricContext, labels: MetricLabels = {}): number {
    return this.values.get(metricContextKey(context, labels)) ?? 0;
  }
}
