import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "../index";
import { DiagnosticRegistry } from "./diagnostic-registry";
import { DiagnosticsEngine } from "./diagnostics-engine";
import { failureCategory, failureSeverity } from "./failure-classifier";
import { MemoryDiagnosticStore, RuntimeInspector } from "./runtime-inspector";

const context: RuntimeContext = {
  correlationId: "correlation",
  requestId: "request",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "admin",
  locale: "en",
  timezone: "UTC",
  channel: "api",
  apiVersion: "v1",
};

const signal = {
  context,
  traceId: "trace",
  service: "api",
  component: "runtime",
  operation: "medicine.search",
  errorCode: "dependency_timeout",
  errorCategory: "external_dependency" as const,
  durationMs: 5000,
  retryable: true,
  evidence: ["trace:trace", "metric:latency"],
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("runtime diagnostics", () => {
  it("classifies failures and severity centrally", () => {
    expect(failureCategory("authorization", "denied")).toBe("authorization_failure");
    expect(failureCategory("infrastructure", "query_timeout")).toBe("dependency_timeout");
    expect(failureSeverity("startup_failure")).toBe("critical");
    expect(failureSeverity("runtime_failure", true)).toBe("warning");
  });

  it("registers provider rules and correlates evidence", async () => {
    const registry = new DiagnosticRegistry();
    registry.register({
      name: "latency",
      rules: [{
        id: "elevated-latency",
        priority: 10,
        evaluate: (input) => input.durationMs && input.durationMs > 1000 ? {
          category: "dependency_timeout",
          severity: "warning",
          confidence: 0.9,
          rootCause: "elevated dependency latency",
          evidence: ["rule:elevated-latency"],
        } : undefined,
      }],
    });
    const store = new MemoryDiagnosticStore();
    const events = await new DiagnosticsEngine(registry, store, () => "diagnostic")
      .inspect(signal);

    expect(events[0]).toMatchObject({
      id: "diagnostic",
      category: "dependency_timeout",
      severity: "warning",
      confidence: 0.9,
      rootCause: "elevated dependency latency",
    });
    expect(events[0]?.evidence).toEqual([
      "rule:elevated-latency", "trace:trace", "metric:latency",
    ]);
  });

  it("deduplicates occurrences and supports inspection filters", async () => {
    const store = new MemoryDiagnosticStore();
    const engine = new DiagnosticsEngine(new DiagnosticRegistry(), store, () => "one");
    await engine.inspect(signal);
    await engine.inspect({ ...signal, timestamp: "2026-01-01T00:01:00.000Z" });
    const inspector = new RuntimeInspector(store);

    const events = await inspector.list({
      severity: "warning",
      category: "dependency_timeout",
      correlationId: "correlation",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      occurrenceCount: 2,
      firstDetected: "2026-01-01T00:00:00.000Z",
      lastDetected: "2026-01-01T00:01:00.000Z",
    });
    expect(await inspector.find("one")).toEqual(events[0]);
  });

  it("evaluates rules within a bounded local baseline", async () => {
    const registry = new DiagnosticRegistry();
    registry.register({
      name: "baseline",
      rules: Array.from({ length: 100 }, (_, index) => ({
        id: `rule-${index}`,
        priority: index,
        evaluate: () => undefined,
      })),
    });
    const engine = new DiagnosticsEngine(registry, new MemoryDiagnosticStore());
    const started = performance.now();
    await engine.inspect({
      context,
      traceId: "trace",
      service: "api",
      component: "runtime",
      operation: "medicine.search",
      evidence: [],
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("does not retain messages, payloads, credentials, or patient data", async () => {
    const events = await new DiagnosticsEngine(
      new DiagnosticRegistry(),
      new MemoryDiagnosticStore(),
      () => "safe",
    ).inspect(signal);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/password|patient|select|payload/i);
  });
});
