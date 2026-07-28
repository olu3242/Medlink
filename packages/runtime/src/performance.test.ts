import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRuntime } from "./index";

describe("runtime performance smoke", () => {
  it("executes 100 in-memory lifecycle operations within the source baseline", async () => {
    let sequence = 0;
    const runtime = createRuntime({
      authenticate: async () => ({
        userId: "00000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000002",
        organizationId: "00000000-0000-4000-8000-000000000002",
        role: "patient",
      }),
      authorizer: { authorize: () => undefined },
      audit: { append: async () => undefined },
      events: { publish: async () => undefined },
      telemetry: { start: () => undefined, finish: () => undefined },
      id: () => `id-${sequence += 1}`,
    });
    const operation = {
      name: "baseline.read",
      permission: "mar:read",
      schema: z.object({}),
      input: async () => ({}),
      execute: async () => ({ ok: true }),
      success: () => Response.json({ ok: true }),
    };
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const response = await runtime(
        new Request("https://medlink.test/api/v1/baseline"),
        operation,
      );
      expect(response.status).toBe(200);
    }
    const durationMs = performance.now() - started;
    expect(durationMs).toBeLessThan(1_000);
  });
});
