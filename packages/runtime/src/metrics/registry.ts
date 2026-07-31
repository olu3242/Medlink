import { Counter } from "./counter";
import { Gauge } from "./gauge";
import { Histogram } from "./histogram";
import { Timer } from "./timer";
import type { MetricSink } from "./metric-types";

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  constructor(private readonly sink?: MetricSink) {}

  counter(name: string): Counter {
    this.validateName(name);
    const existing = this.counters.get(name);
    if (existing) return existing;
    const metric = new Counter(name, this.sink);
    this.counters.set(name, metric);
    return metric;
  }

  gauge(name: string): Gauge {
    this.validateName(name);
    const existing = this.gauges.get(name);
    if (existing) return existing;
    const metric = new Gauge(name, this.sink);
    this.gauges.set(name, metric);
    return metric;
  }

  histogram(name: string, boundaries: readonly number[]): Histogram {
    this.validateName(name);
    const existing = this.histograms.get(name);
    if (existing) return existing;
    const metric = new Histogram(name, boundaries, this.sink);
    this.histograms.set(name, metric);
    return metric;
  }

  timer(name: string, boundaries: readonly number[]): Timer {
    return new Timer(this.histogram(name, boundaries));
  }

  names(): readonly string[] {
    return [...this.counters.keys(), ...this.gauges.keys(), ...this.histograms.keys()]
      .sort();
  }

  gaugeTotal(name: string): number {
    return this.gauges.get(name)?.total() ?? 0;
  }

  private validateName(name: string): void {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid metric name '${name}'`);
    }
  }
}
