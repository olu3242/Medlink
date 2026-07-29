import { describe, expect, it, vi } from "vitest";
import { OutboxDispatcher, WorkflowService } from "./service";

describe("workflows", () => {
  it("skips durably completed steps", async () => {
    let ran = 0;
    const done = {
      id: "w",
      tenantId: "t",
      type: "x",
      status: "running" as const,
      completedSteps: ["a"],
    };
    const service = new WorkflowService({
      findByKey: async () => done,
      create: async () => done,
      markStep: async () => done,
      complete: async (id) => ({ ...done, id, status: "completed" }),
    });
    await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      steps: [{ name: "a", execute: async () => { ran += 1; } }],
    });
    expect(ran).toBe(0);
  });
});

describe("outbox dispatcher", () => {
  it("retries transient consumer failures with exponential delay", async () => {
    const retry = vi.fn();
    const now = new Date("2026-07-29T00:00:00Z");
    const dispatcher = new OutboxDispatcher({
      claim: async () => [{
        id: "event-1",
        tenantId: "tenant-1",
        type: "reservation.created",
        aggregateId: "reservation-1",
        payload: {},
        attempts: 2,
      }],
      published: vi.fn(),
      retry,
      deadLetter: vi.fn(),
    }, [{
      eventType: "reservation.created",
      handle: async () => { throw new Error("temporary"); },
    }], () => now);

    await dispatcher.dispatch("worker-1");

    expect(retry).toHaveBeenCalledWith(
      "event-1",
      new Date("2026-07-29T00:00:04Z"),
      "consumer_failed",
    );
  });

  it("dead-letters events without a registered consumer", async () => {
    const deadLetter = vi.fn();
    const dispatcher = new OutboxDispatcher({
      claim: async () => [{
        id: "event-2",
        tenantId: "tenant-1",
        type: "unknown",
        aggregateId: "aggregate-1",
        payload: {},
        attempts: 0,
      }],
      published: vi.fn(),
      retry: vi.fn(),
      deadLetter,
    }, [], () => new Date());

    await dispatcher.dispatch("worker-1");

    expect(deadLetter).toHaveBeenCalledWith("event-2", "consumer_missing");
  });
});
