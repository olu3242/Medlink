import type { RuntimeContext, RuntimeErrorCategory } from "../index";
import { runtimeMetricContext } from "./metric-context";
import type { MetricsRegistry } from "./registry";

const latencyBuckets = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

export class RuntimeMetricsMiddleware {
  constructor(
    private readonly registry: MetricsRegistry,
    private readonly service: string,
    private readonly environment: string,
  ) {}

  start(context: RuntimeContext, operation: string): void {
    const metricContext = this.context(context, operation);
    this.registry.counter("requests_total").increment(metricContext);
    this.registry.gauge("active_requests").add(metricContext, 1);
  }

  finish(input: {
    context: RuntimeContext;
    operation: string;
    outcome: "succeeded" | "failed";
    durationMs: number;
    errorCategory?: RuntimeErrorCategory | undefined;
  }): void {
    const context = this.context(input.context, input.operation);
    this.registry.gauge("active_requests").add(context, -1);
    this.registry.counter(
      input.outcome === "succeeded" ? "requests_success" : "requests_failed",
    ).increment(context);
    if (input.errorCategory === "authentication") {
      this.registry.counter("requests_unauthorized").increment(context);
    }
    if (input.errorCategory === "authorization") {
      this.registry.counter("requests_forbidden").increment(context);
    }
    this.registry.histogram("api_request_duration_ms", latencyBuckets)
      .observe(context, input.durationMs);
  }

  private context(runtime: RuntimeContext, operation: string) {
    return runtimeMetricContext(runtime, {
      service: this.service,
      component: "runtime",
      operation,
      environment: this.environment,
    });
  }
}
