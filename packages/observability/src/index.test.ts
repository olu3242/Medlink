import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "@medlink/runtime";
import { runtimeDiagnostics, standardRuntimeHooks } from "./index";

const context: RuntimeContext = {
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

// Sprint 4 (RC1 P0 convergence) extracted standardRuntimeHooks from two
// duplicated, drifted copies (apps/web/lib/api-runtime.ts and
// packages/api/src/index.ts) but shipped it with no direct test of its own.
// This is that test: it exercises audit/events/telemetry against the real
// shared enterpriseMetrics/logger singletons rather than mocking them out,
// since those singletons (runtimeDiagnostics()) are already exported and
// inspectable, and the shared function's only job is to wire operations
// through them correctly.
describe("standardRuntimeHooks", () => {
  it("does not throw when the audit and events hooks are invoked", async () => {
    const hooks = standardRuntimeHooks("test-service-audit-events");
    await expect(hooks.audit.append({
      context, operation: "example.op", outcome: "succeeded", durationMs: 5,
    })).resolves.toBeUndefined();
    await expect(hooks.events.publish({
      context, operation: "example.op", outcome: "succeeded",
    })).resolves.toBeUndefined();
  });

  it("increments active_requests on telemetry.start and decrements it on telemetry.finish", () => {
    const hooks = standardRuntimeHooks("test-service-telemetry");
    const before = runtimeDiagnostics().activeRequests ?? 0;

    hooks.telemetry.start({ context, operation: "example.op" });
    expect(runtimeDiagnostics().activeRequests).toBe(before + 1);

    hooks.telemetry.finish({
      context, operation: "example.op", outcome: "succeeded", durationMs: 5,
    });
    expect(runtimeDiagnostics().activeRequests).toBe(before);
  });

  it("does not throw when telemetry.finish reports a failed outcome (the recordRuntimeDiagnostic path)", () => {
    const hooks = standardRuntimeHooks("test-service-failure");
    hooks.telemetry.start({ context, operation: "example.op" });
    expect(() => hooks.telemetry.finish({
      context,
      operation: "example.op",
      outcome: "failed",
      durationMs: 5,
      errorCode: "example_error",
    })).not.toThrow();
  });
});
