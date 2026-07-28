import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import { PinoLogAdapter } from "./logger.adapter";

describe("Pino enterprise log adapter", () => {
  it("maps canonical context without changing field meaning", () => {
    const info = vi.fn();
    const adapter = new PinoLogAdapter({ info } as unknown as Logger);
    adapter.write({
      timestamp: "2026-01-01T00:00:00.000Z",
      severity: "info",
      message: "completed",
      correlationId: "c",
      requestId: "r",
      tenantId: "t",
      organizationId: "t",
      userId: "u",
      workflowId: "w",
      conversationId: "v",
      service: "api",
      component: "middleware",
      operation: "example.read",
      durationMs: 10,
      attributes: { outcome: "succeeded" },
    });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      correlation_id: "c",
      request_id: "r",
      tenant_id: "t",
      organization_id: "t",
      workflow_id: "w",
      conversation_id: "v",
      operation: "example.read",
      duration_ms: 10,
      outcome: "succeeded",
    }), "completed");
  });
});
