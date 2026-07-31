import { describe, expect, it, vi } from "vitest";
import { RuntimeError, type RuntimeContext } from "../index";
import { instrumentRepository } from "./instrumentation";
import { RuntimeTrace } from "./trace";
import { TraceManager } from "./trace-manager";
import type { SpanSnapshot, TraceAdapter } from "./trace-types";

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

function recording() {
  const started: SpanSnapshot[] = [];
  const finished: SpanSnapshot[] = [];
  const adapter: TraceAdapter = {
    started: (span) => started.push({ ...span }),
    finished: (span) => finished.push({ ...span }),
  };
  return { adapter, started, finished };
}

describe("distributed tracing", () => {
  it("creates and completes a root trace", async () => {
    const records = recording();
    const manager = new TraceManager(records.adapter, () => 10);
    await manager.run(context, {
      service: "api",
      component: "runtime",
      operation: "medicine.search",
    }, async () => "done");

    expect(records.started[0]?.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(records.started[0]?.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(records.finished[0]).toMatchObject({
      status: "succeeded",
      durationMs: 0,
      correlationId: "correlation",
    });
  });

  it("preserves parent-child relationships across async work", async () => {
    const records = recording();
    const manager = new TraceManager(records.adapter);
    await manager.run(context, {
      service: "api",
      component: "runtime",
      operation: "request",
    }, async () => {
      await Promise.resolve();
      await manager.run(context, {
        service: "api",
        component: "authorization",
        operation: "authorize",
      }, async () => undefined);
    });

    expect(records.started[1]?.traceId).toBe(records.started[0]?.traceId);
    expect(records.started[1]?.parentSpanId).toBe(records.started[0]?.spanId);
  });

  it("records classified errors without messages or payloads", async () => {
    const records = recording();
    const manager = new TraceManager(records.adapter);
    await expect(manager.run(context, {
      service: "api",
      component: "transaction",
      operation: "commit",
    }, async () => {
      throw new RuntimeError("infrastructure", "commit_failed", "secret", 503, true);
    })).rejects.toThrow("secret");

    expect(records.finished[0]?.error).toEqual({
      code: "commit_failed",
      exceptionType: "RuntimeError",
      retryable: true,
      category: "infrastructure",
    });
    expect(JSON.stringify(records.finished[0])).not.toContain("secret");
  });

  it("instruments repositories without recording SQL", async () => {
    const records = recording();
    const manager = new TraceManager(records.adapter);
    await instrumentRepository(manager, context, {
      service: "medicine",
      repository: "catalog",
      operation: "find",
    }, async () => ({ id: "medicine" }));

    expect(records.started[0]).toMatchObject({
      component: "repository.catalog",
      operation: "find",
    });
    expect(JSON.stringify(records.started[0])).not.toMatch(/select|insert|update/i);
  });

  it("supports detached traces and runtime middleware", async () => {
    const records = recording();
    const manager = new TraceManager(records.adapter);
    const runtime = new RuntimeTrace(manager, "api");
    const work = vi.fn(async () => {
      await manager.detached(context, {
        service: "worker",
        component: "outbox",
        operation: "dispatch",
      }, async () => undefined);
    });
    await runtime.run(context, "request", work);

    expect(work).toHaveBeenCalledOnce();
    expect(records.started[1]?.parentSpanId).toBeUndefined();
    expect(records.started[1]?.traceId).not.toBe(records.started[0]?.traceId);
  });
});
