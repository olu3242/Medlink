import { metricContextKey } from "./metric-context";
import type {
  HistogramSnapshot,
  MetricContext,
  MetricLabels,
  MetricSink,
} from "./metric-types";

interface MutableHistogram {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Record<string, number>;
}

export class Histogram {
  private readonly values = new Map<string, MutableHistogram>();

  constructor(
    readonly name: string,
    readonly boundaries: readonly number[],
    private readonly sink?: MetricSink,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (boundaries.some((value, index) =>
      !Number.isFinite(value) || (index > 0 && value <= boundaries[index - 1]!))) {
      throw new Error("Histogram boundaries must be finite and increasing");
    }
  }

  observe(
    context: MetricContext,
    value: number,
    labels: MetricLabels = {},
  ): void {
    if (!Number.isFinite(value)) throw new Error("Histogram values must be finite");
    const key = metricContextKey(context, labels);
    const current = this.values.get(key) ?? {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      buckets: Object.fromEntries([
        ...this.boundaries.map((boundary) => [String(boundary), 0]),
        ["+Inf", 0],
      ]),
    };
    current.count += 1;
    current.sum += value;
    current.min = Math.min(current.min, value);
    current.max = Math.max(current.max, value);
    for (const boundary of this.boundaries) {
      if (value <= boundary) current.buckets[String(boundary)]! += 1;
    }
    current.buckets["+Inf"]! += 1;
    this.values.set(key, current);
    void this.sink?.record({
      name: this.name,
      kind: "histogram",
      context,
      labels,
      value,
      observedAt: this.now().toISOString(),
    });
  }

  snapshot(
    context: MetricContext,
    labels: MetricLabels = {},
  ): HistogramSnapshot {
    const value = this.values.get(metricContextKey(context, labels));
    return value
      ? { ...value, buckets: { ...value.buckets } }
      : { count: 0, sum: 0, min: 0, max: 0, buckets: {} };
  }
}
