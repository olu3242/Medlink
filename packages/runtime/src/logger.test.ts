import { describe, expect, it } from "vitest";
import { EnterpriseLogger } from "./logger";
import { runtimeLogContext, withLogOperation } from "./logger.context";
import { MemoryLogAdapter } from "./logger.adapter";

const runtime = {
  correlationId: "correlation",
  requestId: "request",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  workflowId: "workflow",
  conversationId: "conversation",
  role: "patient",
  locale: "en",
  timezone: "UTC",
  channel: "api",
  apiVersion: "v1",
};

describe("enterprise logger", () => {
  it("enriches every record with canonical runtime context", async () => {
    const adapter = new MemoryLogAdapter();
    const context = runtimeLogContext(runtime, {
      service: "medlink-api",
      component: "middleware",
      operation: "example.read",
    });
    await new EnterpriseLogger(adapter, context, () => new Date(0))
      .info("operation completed", {
        durationMs: 12,
        attributes: { outcome: "succeeded" },
      });
    expect(adapter.entries).toEqual([expect.objectContaining({
      timestamp: "1970-01-01T00:00:00.000Z",
      severity: "info",
      correlationId: "correlation",
      requestId: "request",
      tenantId: runtime.tenantId,
      organizationId: runtime.organizationId,
      userId: runtime.userId,
      workflowId: "workflow",
      conversationId: "conversation",
      service: "medlink-api",
      component: "middleware",
      operation: "example.read",
      durationMs: 12,
    })]);
  });

  it("creates child operation context without losing identity", async () => {
    const adapter = new MemoryLogAdapter();
    const base = runtimeLogContext(runtime, {
      service: "medlink-api",
      component: "middleware",
      operation: "request",
    });
    const context = withLogOperation(base, "repository.query", "repository");
    await new EnterpriseLogger(adapter, context).error("query failed", {
      errorCode: "database_unavailable",
    });
    expect(adapter.entries[0]).toMatchObject({
      correlationId: "correlation",
      component: "repository",
      operation: "repository.query",
      severity: "error",
      errorCode: "database_unavailable",
    });
  });
});
