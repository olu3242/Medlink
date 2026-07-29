import { describe, expect, it, vi } from "vitest";
import { AdapterUnavailableError, OperationalAdapterRegistry } from "./operational-adapters";

describe("operational adapter registry", () => {
  it("journals adapter output and replays it idempotently", async () => {
    let recorded: unknown = null;
    const execute = vi.fn(async () => ({ reference: "provider-1" }));
    const registry = new OperationalAdapterRegistry([{
      capability: "payment",
      health: async () => ({ available: true }),
      execute,
    }], {
      find: async () => recorded,
      commit: async (entry) => { recorded = entry.output; },
    });
    const context = {
      tenantId: "tenant-1",
      correlationId: "correlation-1",
      idempotencyKey: "key-1",
    };
    await registry.invoke("payment", context, { token: "opaque-token" });
    await registry.invoke("payment", context, { token: "opaque-token" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a required adapter is unhealthy", async () => {
    const registry = new OperationalAdapterRegistry([], {
      find: async () => null,
      commit: async () => undefined,
    });
    await expect(registry.invoke("security", {
      tenantId: "tenant-1",
      correlationId: "correlation-1",
      idempotencyKey: "key-1",
    }, {})).rejects.toBeInstanceOf(AdapterUnavailableError);
  });
});
