import type { RuntimeContext } from "@medlink/runtime";
import type { WorkflowInstance, WorkflowStore } from "@medlink/workflows";
import { WorkflowService } from "@medlink/workflows";
import { describe, expect, it } from "vitest";
import { AgentPlanAuthorizationError, buildAgentPlan, toWorkflowSteps } from "./planning";

// Mirrors packages/workflows/src/service.test.ts's InMemoryWorkflowStore --
// a real (if minimal) fake, not a fixture that skips create()/markStep().
class InMemoryWorkflowStore implements WorkflowStore {
  private byId = new Map<string, WorkflowInstance>();

  async findByKey(tenantId: string, key: string): Promise<WorkflowInstance | null> {
    const instance = this.byId.get(key);
    return instance && instance.tenantId === tenantId ? instance : null;
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

const patientContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-0000-0000-000000000001",
  organizationId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  role: "patient",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

describe("buildAgentPlan", () => {
  it("builds a plan when every step names a real, declared capability", () => {
    const result = buildAgentPlan("WF-005", [
      { agentId: "conversation", capabilityName: "route_intent", execute: async () => undefined },
    ]);
    expect(result.violations).toEqual([]);
    expect(result.plan?.workflowType).toBe("WF-005");
  });

  it("refuses a step naming a capability that was never registered", () => {
    const result = buildAgentPlan("WF-005", [
      { agentId: "conversation", capabilityName: "invent_a_capability", execute: async () => undefined },
    ]);
    expect(result.plan).toBeUndefined();
    expect(result.violations).toEqual([
      "conversation.invent_a_capability is not a declared capability",
    ]);
  });

  it("refuses a step naming an unregistered agent entirely", () => {
    const result = buildAgentPlan("WF-005", [
      { agentId: "ghost-agent", capabilityName: "anything", execute: async () => undefined },
    ]);
    expect(result.violations).toEqual(["ghost-agent.anything is not a declared capability"]);
  });
});

describe("toWorkflowSteps + WorkflowService integration", () => {
  it("runs an autonomous, permitted capability to completion through the real WorkflowService", async () => {
    let handlerRan = 0;
    const { plan } = buildAgentPlan("WF-005", [
      {
        agentId: "conversation",
        capabilityName: "route_intent",
        execute: async () => {
          handlerRan += 1;
          return { intent: "medicine_search" };
        },
      },
    ]);
    const service = new WorkflowService(new InMemoryWorkflowStore());

    const result = await service.run({
      tenantId: patientContext.tenantId,
      type: plan!.workflowType,
      idempotencyKey: "plan-run-1",
      steps: toWorkflowSteps(patientContext, plan!),
    });

    expect(handlerRan).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.completedSteps).toEqual(["conversation.route_intent"]);
    expect(result.context.intent).toBe("medicine_search");
  });

  it("halts the whole plan on the first denied step, without running its handler", async () => {
    let handlerRan = 0;
    const { plan } = buildAgentPlan("WF-007", [
      {
        // clinical-review-assistant's flag_validation_findings capability
        // is requiresHumanApproval: true -- it can never be authorized for
        // autonomous execution, regardless of role.
        agentId: "clinical-review-assistant",
        capabilityName: "flag_validation_findings",
        execute: async () => {
          handlerRan += 1;
        },
      },
    ]);
    const service = new WorkflowService(new InMemoryWorkflowStore());
    const pharmacistContext: RuntimeContext = { ...patientContext, role: "pharmacist" };

    await expect(
      service.run({
        tenantId: patientContext.tenantId,
        type: plan!.workflowType,
        idempotencyKey: "plan-run-2",
        steps: toWorkflowSteps(pharmacistContext, plan!),
      }),
    ).rejects.toThrow(AgentPlanAuthorizationError);

    expect(handlerRan).toBe(0);
  });

  it("halts on a role the capability does not permit", async () => {
    const { plan } = buildAgentPlan("WF-005", [
      { agentId: "conversation", capabilityName: "route_intent", execute: async () => undefined },
    ]);
    const service = new WorkflowService(new InMemoryWorkflowStore());
    const unrelatedRoleContext: RuntimeContext = { ...patientContext, role: "tenant_admin" };

    await expect(
      service.run({
        tenantId: patientContext.tenantId,
        type: plan!.workflowType,
        idempotencyKey: "plan-run-3",
        steps: toWorkflowSteps(unrelatedRoleContext, plan!),
      }),
    ).rejects.toThrow(/role_not_permitted/);
  });
});
