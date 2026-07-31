import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRuntime, RuntimeError } from "./index";

function dependencies(overrides: Partial<Parameters<typeof createRuntime>[0]> = {}) {
  return {
    authenticate: vi.fn(async () => ({
      userId: "00000000-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000002",
      organizationId: "00000000-0000-4000-8000-000000000002",
      role: "patient",
    })),
    authorizer: { authorize: vi.fn() },
    audit: { append: vi.fn() },
    events: { publish: vi.fn() },
    telemetry: { start: vi.fn(), finish: vi.fn() },
    id: vi.fn()
      .mockReturnValueOnce("correlation")
      .mockReturnValueOnce("request"),
    now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(15),
    ...overrides,
  };
}

describe("enterprise runtime", () => {
  it("executes authorization, use case, event, audit, and telemetry", async () => {
    const deps = dependencies();
    const response = await createRuntime(deps)(
      new Request("https://medlink.test/api/v1/example"),
      {
        name: "example.read",
        permission: "mar:read",
        schema: z.object({}),
        input: async () => ({}),
        execute: async () => ({ ok: true }),
        success: (output) => Response.json(output),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("correlation");
    expect(deps.authorizer.authorize).toHaveBeenCalledOnce();
    expect(deps.events.publish).toHaveBeenCalledOnce();
    expect(deps.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "succeeded", durationMs: 5 }),
    );
    expect(deps.telemetry.finish).toHaveBeenCalledOnce();
  });

  it("returns stable safe problems and does not execute after denial", async () => {
    const execute = vi.fn();
    const deps = dependencies({
      authorizer: {
        authorize: () => {
          throw new RuntimeError(
            "authorization",
            "permission_denied",
            "Permission denied",
            403,
          );
        },
      },
    });
    const response = await createRuntime(deps)(
      new Request("https://medlink.test/api/v1/example"),
      {
        name: "example.write",
        permission: "inventory:manage",
        schema: z.object({}),
        input: async () => ({}),
        execute,
        success: () => Response.json({}),
      },
    );
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "permission_denied",
      correlationId: "correlation",
    });
  });

  it("rejects mismatched tenant and organization context", async () => {
    const deps = dependencies({
      authenticate: async () => ({
        userId: "00000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000002",
        organizationId: "00000000-0000-4000-8000-000000000003",
        role: "patient",
      }),
    });
    const response = await createRuntime(deps)(
      new Request("https://medlink.test/api/v1/example"),
      {
        name: "example.read",
        permission: "mar:read",
        schema: z.object({}),
        input: async () => ({}),
        execute: async () => ({}),
        success: () => Response.json({}),
      },
    );
    expect(response.status).toBe(400);
  });

  it("is replay-safe when the use case implements idempotency", async () => {
    const committed = new Map<string, { id: string }>();
    const execute = async (input: { key: string }) => {
      const prior = committed.get(input.key);
      if (prior) return prior;
      const value = { id: "created-once" };
      committed.set(input.key, value);
      return value;
    };
    const operation = {
      name: "example.create",
      permission: "mar:create",
      schema: z.object({ key: z.string() }),
      input: async () => ({ key: "same-key" }),
      execute,
      success: (output: { id: string }) => Response.json(output),
    };
    await createRuntime(dependencies())(
      new Request("https://medlink.test/api/v1/example"),
      operation,
    );
    await createRuntime(dependencies())(
      new Request("https://medlink.test/api/v1/example"),
      operation,
    );
    expect(committed).toHaveLength(1);
  });
});
