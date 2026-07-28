import { describe, expect, it, vi } from "vitest";
import {
  RecoveryPolicy,
  TransactionManager,
  type TransactionDriver,
} from "./transaction";

function driver(): TransactionDriver & {
  begin: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
} {
  return {
    begin: vi.fn(async ({ correlationId, attempt }) => ({
      id: `tx-${attempt}`,
      correlationId,
      attempt,
    })),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
}

describe("transaction manager", () => {
  it("commits successful work", async () => {
    const value = driver();
    const manager = new TransactionManager(value);
    await expect(manager.run(
      { correlationId: "c" },
      async () => "done",
    )).resolves.toBe("done");
    expect(value.commit).toHaveBeenCalledOnce();
    expect(value.rollback).not.toHaveBeenCalled();
  });

  it("rolls back and retries retryable failures", async () => {
    const value = driver();
    const manager = new TransactionManager(value);
    let attempts = 0;
    await expect(manager.run(
      { correlationId: "c", maxAttempts: 2, retryable: () => true },
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("serialization");
        return "done";
      },
    )).resolves.toBe("done");
    expect(value.rollback).toHaveBeenCalledOnce();
    expect(value.commit).toHaveBeenCalledOnce();
  });

  it("reuses a nested transaction and rejects context drift", async () => {
    const value = driver();
    const manager = new TransactionManager(value);
    await manager.run({ correlationId: "c" }, async (outer) => {
      await expect(manager.run(
        { correlationId: "c" },
        async (inner) => inner.id,
      )).resolves.toBe(outer.id);
      await expect(manager.run(
        { correlationId: "other" },
        async () => undefined,
      )).rejects.toMatchObject({ code: "nested_transaction_context_mismatch" });
    });
    expect(value.begin).toHaveBeenCalledOnce();
  });
});

describe("recovery policy", () => {
  it("backs off retries and dead-letters exhausted events", async () => {
    const store = {
      retry: vi.fn(async () => undefined),
      deadLetter: vi.fn(async () => undefined),
    };
    const policy = new RecoveryPolicy(store, 2, 100);
    await expect(policy.failure({
      eventId: "e",
      payload: {},
      errorCode: "dependency_failed",
      retryCount: 1,
    }, new Date(0))).resolves.toBe("retry");
    expect(store.retry).toHaveBeenCalledWith(
      "e",
      new Date(200),
      "dependency_failed",
    );
    await expect(policy.failure({
      eventId: "e",
      payload: {},
      errorCode: "dependency_failed",
      retryCount: 2,
    })).resolves.toBe("dead_letter");
    expect(store.deadLetter).toHaveBeenCalledOnce();
  });
});
