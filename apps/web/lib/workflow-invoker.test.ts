import { describe, expect, it } from "vitest";
import { WorkflowService, type WorkflowInstance, type WorkflowStore } from "@medlink/workflows";
import type { MedicineSearchService, SearchPage } from "@medlink/search";
import { UnsupportedWorkflowTypeError, WorkflowOrchestratorInvoker } from "./workflow-invoker";

class InMemoryWorkflowStore implements WorkflowStore {
  private byId = new Map<string, WorkflowInstance>();

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
    const updated = { ...existing, completedSteps: [...existing.completedSteps, step], context: { ...existing.context, ...contextPatch } };
    this.byId.set(id, updated);
    return updated;
  }

  async complete(id: string): Promise<WorkflowInstance> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`No workflow instance '${id}'`);
    const updated = { ...existing, status: "completed" as const };
    this.byId.set(id, updated);
    return updated;
  }
}

class FakeSearchService implements MedicineSearchService {
  async search(): Promise<SearchPage> {
    return { matches: [] };
  }
}

const organizationId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";

describe("WorkflowOrchestratorInvoker", () => {
  it("runs the medicine_search workflow and returns the completed instance's id and status", async () => {
    const invoker = new WorkflowOrchestratorInvoker(
      new WorkflowService(new InMemoryWorkflowStore()),
      new FakeSearchService(),
    );

    const result = await invoker.invoke({
      organizationId,
      conversationId,
      workflowType: "medicine_search",
      idempotencyKey: "wamid.001",
      context: { term: "ibuprofen" },
    });

    expect(result).toEqual({ workflowInstanceId: "wamid.001", status: "completed" });
  });

  it("seeds the workflow's context with the conversation id alongside the caller's context", async () => {
    const store = new InMemoryWorkflowStore();
    const invoker = new WorkflowOrchestratorInvoker(new WorkflowService(store), new FakeSearchService());

    await invoker.invoke({
      organizationId,
      conversationId,
      workflowType: "medicine_search",
      idempotencyKey: "wamid.002",
      context: { term: "ibuprofen" },
    });

    const instance = await store.findByKey(organizationId, "wamid.002");
    expect(instance?.context).toMatchObject({ conversationId, term: "ibuprofen" });
  });

  it("throws UnsupportedWorkflowTypeError for an intent with no wired canonical workflow", async () => {
    const invoker = new WorkflowOrchestratorInvoker(
      new WorkflowService(new InMemoryWorkflowStore()),
      new FakeSearchService(),
    );

    await expect(
      invoker.invoke({
        organizationId,
        conversationId,
        workflowType: "refill_request",
        idempotencyKey: "wamid.003",
        context: {},
      }),
    ).rejects.toThrow(UnsupportedWorkflowTypeError);
  });
});
