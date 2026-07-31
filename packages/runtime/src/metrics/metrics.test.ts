import { describe, expect, it, vi } from "vitest";
import type { RuntimeContext } from "../index";
import { Counter } from "./counter";
import { Gauge } from "./gauge";
import { Histogram } from "./histogram";
import { runtimeMetricContext } from "./metric-context";
import { RuntimeMetricsMiddleware } from "./middleware";
import { MetricsRegistry } from "./registry";
import { Timer } from "./timer";

const runtime: RuntimeContext = {
  correlationId: "correlation",
  requestId: "request",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "patient",
  locale: "en",
  timezone: "UTC",
  channel: "api",
  apiVersion: "v1",
};
const context = runtimeMetricContext(runtime, {
  service: "api",
  component: "runtime",
  operation: "example.read",
  environment: "test",
});

describe("metric primitives", () => {
  it("increments counters monotonically", () => {
    const counter = new Counter("requests_total");
    expect(counter.increment(context)).toBe(1);
    expect(counter.increment(context, 2)).toBe(3);
    expect(() => counter.increment(context, -1)).toThrow();
  });

  it("sets and adjusts gauges", () => {
    const gauge = new Gauge("active_requests");
    gauge.set(context, 2);
    expect(gauge.add(context, -1)).toBe(1);
    expect(gauge.value(context)).toBe(1);
  });

  it("records histogram distributions", () => {
    const histogram = new Histogram("api_request_duration_ms", [10, 100]);
    histogram.observe(context, 5);
    histogram.observe(context, 50);
    expect(histogram.snapshot(context)).toEqual({
      count: 2,
      sum: 55,
      min: 5,
      max: 50,
      buckets: { "10": 1, "100": 2, "+Inf": 2 },
    });
  });

  it("times async operations even when they fail", async () => {
    const histogram = new Histogram("repository_duration_ms", [10]);
    const now = vi.fn().mockReturnValueOnce(2).mockReturnValueOnce(7);
    const timer = new Timer(histogram, now);
    await expect(timer.time(context, async () => {
      throw new Error("failure");
    })).rejects.toThrow("failure");
    expect(histogram.snapshot(context).sum).toBe(5);
  });
});

describe("metrics registry and context", () => {
  it("centralizes metrics and validates naming", () => {
    const registry = new MetricsRegistry();
    expect(registry.counter("requests_total"))
      .toBe(registry.counter("requests_total"));
    expect(() => registry.counter("Requests.Total")).toThrow();
    expect(registry.names()).toEqual(["requests_total"]);
  });

  it("automatically propagates required runtime dimensions", () => {
    expect(context).toEqual({
      correlationId: "correlation",
      tenantId: runtime.tenantId,
      organizationId: runtime.organizationId,
      service: "api",
      component: "runtime",
      operation: "example.read",
      environment: "test",
    });
  });
});

describe("runtime metrics middleware", () => {
  it("records request lifecycle without business-service instrumentation", () => {
    const registry = new MetricsRegistry();
    const middleware = new RuntimeMetricsMiddleware(registry, "api", "test");
    middleware.start(runtime, "example.read");
    middleware.finish({
      context: runtime,
      operation: "example.read",
      outcome: "succeeded",
      durationMs: 12,
    });
    expect(registry.counter("requests_total").value(context)).toBe(1);
    expect(registry.counter("requests_success").value(context)).toBe(1);
    expect(registry.gauge("active_requests").value(context)).toBe(0);
    expect(registry.histogram("api_request_duration_ms", [])
      .snapshot(context).count).toBe(1);
  });

  it("classifies authorization failures", () => {
    const registry = new MetricsRegistry();
    const middleware = new RuntimeMetricsMiddleware(registry, "api", "test");
    middleware.start(runtime, "example.read");
    middleware.finish({
      context: runtime,
      operation: "example.read",
      outcome: "failed",
      durationMs: 2,
      errorCategory: "authorization",
    });
    expect(registry.counter("requests_failed").value(context)).toBe(1);
    expect(registry.counter("requests_forbidden").value(context)).toBe(1);
  });
});
