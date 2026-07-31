import { describe, expect, it, vi } from "vitest";
import {
  FulfillmentConflictError,
  FulfillmentCoordinator,
  type FulfillmentRun,
  type FulfillmentStore,
} from "./fulfillment";

function fixture() {
  let run: FulfillmentRun = {
    id: "run-1",
    tenantId: "tenant-1",
    reservationId: "reservation-1",
    stage: "locking_inventory",
    completed: [],
  };
  const store: FulfillmentStore = {
    find: async () => null,
    begin: async () => run,
    advance: async (_id, expected, stage, step, inventoryLockId) => {
      if (run.stage !== expected) return null;
      run = {
        ...run,
        stage,
        completed: [...run.completed, step],
        ...(inventoryLockId ? { inventoryLockId } : {}),
      };
      return run;
    },
  };
  const ports = {
    lock: vi.fn(async () => ({ id: "lock-1" })),
    release: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    requestHandoff: vi.fn(async () => undefined),
  };
  return { coordinator: new FulfillmentCoordinator(store, ports), ports, current: () => run };
}

describe("fulfillment coordinator", () => {
  it("orders reservation, pickup readiness, and collection", async () => {
    const value = fixture();
    const reserved = await value.coordinator.reserve({
      tenantId: "tenant-1",
      reservationId: "reservation-1",
      idempotencyKey: "key-1",
    });
    const ready = await value.coordinator.markReady(reserved);
    const collected = await value.coordinator.collect(ready);
    expect(collected.stage).toBe("collected");
    expect(value.ports.notify).toHaveBeenNthCalledWith(1, expect.anything(), "reserved");
    expect(value.ports.notify).toHaveBeenNthCalledWith(2, expect.anything(), "ready");
    expect(value.ports.notify).toHaveBeenNthCalledWith(3, expect.anything(), "collected");
    expect(value.current().completed)
      .toEqual(["inventory.locked", "pickup.ready", "pickup.collected"]);
  });

  it("hands off an inventory outage for recovery", async () => {
    const value = fixture();
    value.ports.lock.mockRejectedValueOnce(new Error("database unavailable"));
    const run = await value.coordinator.reserve({
      tenantId: "tenant-1",
      reservationId: "reservation-1",
      idempotencyKey: "key-1",
    });
    expect(run.stage).toBe("waiting_for_human");
    expect(value.ports.requestHandoff).toHaveBeenCalledWith(
      expect.anything(),
      "inventory_lock_failed",
    );
  });

  it("rejects a stale concurrent transition", async () => {
    const value = fixture();
    const reserved = await value.coordinator.reserve({
      tenantId: "tenant-1",
      reservationId: "reservation-1",
      idempotencyKey: "key-1",
    });
    await value.coordinator.markReady(reserved);
    await expect(value.coordinator.markReady(reserved))
      .rejects.toBeInstanceOf(FulfillmentConflictError);
  });

  it("makes compensation replay safe", async () => {
    const value = fixture();
    const reserved = await value.coordinator.reserve({
      tenantId: "tenant-1",
      reservationId: "reservation-1",
      idempotencyKey: "key-1",
    });
    const compensated = await value.coordinator.compensate(reserved);
    await value.coordinator.compensate(compensated);
    expect(value.ports.release).toHaveBeenCalledTimes(1);
  });
});
