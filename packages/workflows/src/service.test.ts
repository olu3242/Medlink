import { describe, expect, it } from "vitest";
import type { WorkflowInstance, WorkflowStore } from "./service";
import { WorkflowService } from "./service";

function baseInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "x",
    status: "running",
    completedSteps: [],
    context: {},
    ...overrides,
  };
}

class InMemoryWorkflowStore implements WorkflowStore {
  private instance: WorkflowInstance;

  constructor(initial: WorkflowInstance) {
    this.instance = initial;
  }

  async findByKey(): Promise<WorkflowInstance | null> {
    return this.instance;
  }

  async create(): Promise<WorkflowInstance> {
    return this.instance;
  }

  async markStep(
    id: string,
    step: string,
    contextPatch: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowInstance> {
    this.instance = {
      ...this.instance,
      id,
      completedSteps: [...this.instance.completedSteps, step],
      context: { ...this.instance.context, ...contextPatch },
    };
    return this.instance;
  }

  async complete(id: string): Promise<WorkflowInstance> {
    this.instance = { ...this.instance, id, status: "completed" };
    return this.instance;
  }
}

describe("WorkflowService", () => {
  it("skips durably completed steps", async () => {
    let ran = 0;
    const store = new InMemoryWorkflowStore(baseInstance({ completedSteps: ["a"] }));
    const service = new WorkflowService(store);

    await service.run({
      tenantId: "t",
      type: "x",
      idempotencyKey: "k",
      steps: [{ name: "a", execute: async () => { ran += 1; } }],
    });

    expect(ran).toBe(0);
  });

  it("runs a not-yet-completed step and marks it complete", async () => {
    let ran = 0;
    const store = new InMemoryWorkflowStore(baseInstance());
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

  it("merges each step's returned context patch into the instance, available to later steps", async () => {
    const store = new InMemoryWorkflowStore(baseInstance());
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
    const store = new InMemoryWorkflowStore(baseInstance({ status: "completed", completedSteps: ["a"] }));
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
});
