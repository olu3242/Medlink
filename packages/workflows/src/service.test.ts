import { describe, expect, it } from "vitest";
import type { WorkflowInstance, WorkflowStore } from "./service";
import { WorkflowService } from "./service";

// A real (if minimal) fake: unlike a fixture that always resolves
// findByKey to a pre-seeded instance, this one starts empty, so create()
// is actually exercised -- including the initial context it's seeded
// with -- rather than a path every test silently skips.
class InMemoryWorkflowStore implements WorkflowStore {
  private nextId = 1;
  private byId = new Map<string, WorkflowInstance>();

  constructor(seed?: WorkflowInstance) {
    if (seed) this.byId.set(seed.id, seed);
  }

  async findByKey(tenantId: string, key: string): Promise<WorkflowInstance | null> {
    for (const instance of this.byId.values()) {
      if (instance.tenantId === tenantId && instance.id === key) return instance;
    }
    return null;
  }

  async create(input: {
    tenantId: string;
    type: string;
    idempotencyKey: string;
    context?: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInstance> {
    const instance: WorkflowInstance = {
      id: input.idempotencyKey,
      tenantId: input.tenantId,
      type: input.type,
      status: "running",
      completedSteps: [],
      context: input.context ?? {},
    };
    this.byId.set(instance.id, instance);
    return instance;
  }

  async markStep(
    id: string,
    step: string,
    contextPatch: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowInstance> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`No workflow instance '${id}'`);
    const updated: WorkflowInstance = {
      ...existing,
      completedSteps: [...existing.completedSteps, step],
      context: { ...existing.context, ...contextPatch },
    };
    this.byId.set(id, updated);
    return updated;
  }

  async complete(id: string): Promise<WorkflowInstance> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`No workflow instance '${id}'`);
    const updated: WorkflowInstance = { ...existing, status: "completed" };
    this.byId.set(id, updated);
    return updated;
  }
}

describe("WorkflowService", () => {
  it("skips durably completed steps on replay", async () => {
    let ran = 0;
    const store = new InMemoryWorkflowStore({
      id: "k",
      tenantId: "t",
      type: "x",
      status: "running",
      completedSteps: ["a"],
      context: {},
    });
    const service = new WorkflowService(store);

    await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      steps: [{ name: "a", execute: async () => { ran += 1; } }],
    });

    expect(ran).toBe(0);
  });

  it("creates a new instance and runs a not-yet-completed step", async () => {
    let ran = 0;
    const store = new InMemoryWorkflowStore();
    const service = new WorkflowService(store);

    const result = await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      steps: [{ name: "a", execute: async () => { ran += 1; } }],
    });

    expect(ran).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.completedSteps).toContain("a");
  });

  it("seeds the new instance's context from run()'s input, available to the first step", async () => {
    const store = new InMemoryWorkflowStore();
    const service = new WorkflowService(store);
    const seenTerm: unknown[] = [];

    await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      context: { term: "ibuprofen" },
      steps: [
        {
          name: "a",
          execute: async (instance) => {
            seenTerm.push(instance.context.term);
          },
        },
      ],
    });

    expect(seenTerm).toEqual(["ibuprofen"]);
  });

  it("merges each step's returned context patch into the instance, available to later steps", async () => {
    const store = new InMemoryWorkflowStore();
    const service = new WorkflowService(store);
    const seenByStepB: unknown[] = [];

    await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      steps: [
        { name: "a", execute: async () => ({ term: "ibuprofen" }) },
        {
          name: "b",
          execute: async (instance) => {
            seenByStepB.push(instance.context.term);
            return { matchCount: 3 };
          },
        },
      ],
    });

    expect(seenByStepB).toEqual(["ibuprofen"]);
  });

  it("returns the already-completed instance unchanged rather than re-running any step", async () => {
    let ran = 0;
    const store = new InMemoryWorkflowStore({
      id: "k",
      tenantId: "t",
      type: "x",
      status: "completed",
      completedSteps: ["a"],
      context: {},
    });
    const service = new WorkflowService(store);

    const result = await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      steps: [{ name: "a", execute: async () => { ran += 1; } }],
    });

    expect(ran).toBe(0);
    expect(result.status).toBe("completed");
  });

  it("replays idempotently: a second run() with the same tenant and key does not re-create or re-run", async () => {
    let ran = 0;
    const store = new InMemoryWorkflowStore();
    const service = new WorkflowService(store);
    const steps = [{ name: "a", execute: async () => { ran += 1; } }];

    await service.run({ tenantId: "t", type: "x", idempotencyKey: "k", steps });
    await service.run({ tenantId: "t", type: "x", idempotencyKey: "k", steps });

    expect(ran).toBe(1);
  });
});
