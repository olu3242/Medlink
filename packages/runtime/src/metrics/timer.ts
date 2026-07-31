import type { MetricContext, MetricLabels } from "./metric-types";
import type { Histogram } from "./histogram";

export class Timer {
  constructor(
    private readonly histogram: Histogram,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(context: MetricContext, labels: MetricLabels = {}): () => number {
    const startedAt = this.now();
    return () => {
      const durationMs = this.now() - startedAt;
      this.histogram.observe(context, durationMs, labels);
      return durationMs;
    };
  }

  async time<T>(
    context: MetricContext,
    work: () => Promise<T>,
    labels: MetricLabels = {},
  ): Promise<T> {
    const finish = this.start(context, labels);
    try {
      return await work();
    } finally {
      finish();
    }
  }
}
