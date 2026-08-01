import type { RuntimeContext } from "@medlink/runtime";
import type { WorkflowInstance, WorkflowStore } from "@medlink/workflows";
import { WorkflowService } from "@medlink/workflows";
import { describe, expect, it } from "vitest";
import { buildAgentPlan } from "./planning";
import {
  EscalationRejectedError,
  InMemoryEscalationStore,
  PendingEscalationError,
  toSupervisedWorkflowSteps,
} from "./supervision";

// Mirrors packages/workflows/src/service.test.ts's InMemoryWorkflowStore.
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

const pharmacistContext: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-0000-0000-000000000001",
  organizationId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  role: "pharmacist",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

describe("InMemoryEscalationStore", () => {
  it("raises idempotently on the same idempotency key", async () => {
    const store = new InMemoryEscalationStore();
    const input = {
      organizationId: "org-1",
      agentId: "clinical-review-assistant",
      capabilityName: "flag_validation_findings",
      workflowType: "WF-007",
      subjectId: "patient-1",
      idempotencyKey: "key-1",
    };
    const first = await store.raise(input);
    const second = await store.raise(input);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("pending");
  });

  it("replays an identical redecision instead of throwing", async () => {
    const store = new InMemoryEscalationStore();
    const escalation = await store.raise({
      organizationId: "org-1",
      agentId: "clinical-review-assistant",
      capabilityName: "flag_validation_findings",
      workflowType: "WF-007",
      subjectId: "patient-1",
      idempotencyKey: "key-1",
    });
    const decideInput = {
      escalationId: escalation.id,
      decidedBy: "pharmacist-1",
      status: "approved" as const,
      rationale: "Reviewed with patient.",
    };
    const first = await store.decide(decideInput);
    const second = await store.decide(decideInput);
    expect(first).toEqual(second);
    expect(first.status).toBe("approved");
  });

  it("rejects a conflicting redecision of an already-decided escalation", async () => {
    const store = new InMemoryEscalationStore();
    const escalation = await store.raise({
      organizationId: "org-1",
      agentId: "clinical-review-assistant",
      capabilityName: "flag_validation_findings",
      workflowType: "WF-007",
      subjectId: "patient-1",
      idempotencyKey: "key-1",
    });
    await store.decide({
      escalationId: escalation.id,
      decidedBy: "pharmacist-1",
      status: "approved",
      rationale: "Reviewed with patient.",
    });
    await expect(store.decide({
      escalationId: escalation.id,
      decidedBy: "pharmacist-1",
      status: "rejected",
      rationale: "Changed my mind.",
    })).rejects.toThrow("Agent escalation has already been decided");
  });
});

describe("toSupervisedWorkflowSteps + WorkflowService integration", () => {
  it("blocks a plan on a pending escalation without running the step's handler", async () => {
    let handlerRan = 0;
    const { plan } = buildAgentPlan("WF-007", [{
      agentId: "clinical-review-assistant",
      capabilityName: "flag_validation_findings",
      execute: async () => { handlerRan += 1; },
    }]);
    const escalations = new InMemoryEscalationStore();
    const service = new WorkflowService(new InMemoryWorkflowStore());

    await expect(
      service.run({
        tenantId: pharmacistContext.tenantId,
        type: plan!.workflowType,
        idempotencyKey: "wf-instance-1",
        steps: toSupervisedWorkflowSteps(pharmacistContext, plan!, escalations, "patient-1"),
      }),
    ).rejects.toThrow(PendingEscalationError);

    expect(handlerRan).toBe(0);
  });

  it("resumes and runs the handler once the escalation is approved, replaying the same idempotency key", async () => {
    let handlerRan = 0;
    const { plan } = buildAgentPlan("WF-007", [{
      agentId: "clinical-review-assistant",
      capabilityName: "flag_validation_findings",
      execute: async () => { handlerRan += 1; return { acknowledged: true }; },
    }]);
    const escalations = new InMemoryEscalationStore();
    const workflowStore = new InMemoryWorkflowStore();
    const service = new WorkflowService(workflowStore);

    let caught: PendingEscalationError | undefined;
    try {
      await service.run({
        tenantId: pharmacistContext.tenantId,
        type: plan!.workflowType,
        idempotencyKey: "wf-instance-2",
        steps: toSupervisedWorkflowSteps(pharmacistContext, plan!, escalations, "patient-1"),
      });
    } catch (error) {
      caught = error as PendingEscalationError;
    }
    expect(caught).toBeInstanceOf(PendingEscalationError);

    await escalations.decide({
      escalationId: caught!.escalation.id,
      decidedBy: pharmacistContext.userId,
      status: "approved",
      rationale: "Reviewed with patient and prescriber.",
    });

    const result = await service.run({
      tenantId: pharmacistContext.tenantId,
      type: plan!.workflowType,
      idempotencyKey: "wf-instance-2",
      steps: toSupervisedWorkflowSteps(pharmacistContext, plan!, escalations, "patient-1"),
    });

    expect(handlerRan).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.context.acknowledged).toBe(true);
  });

  it("halts permanently once the escalation is rejected, still without running the handler", async () => {
    let handlerRan = 0;
    const { plan } = buildAgentPlan("WF-007", [{
      agentId: "clinical-review-assistant",
      capabilityName: "flag_validation_findings",
      execute: async () => { handlerRan += 1; },
    }]);
    const escalations = new InMemoryEscalationStore();
    const service = new WorkflowService(new InMemoryWorkflowStore());

    let caught: PendingEscalationError | undefined;
    try {
      await service.run({
        tenantId: pharmacistContext.tenantId,
        type: plan!.workflowType,
        idempotencyKey: "wf-instance-3",
        steps: toSupervisedWorkflowSteps(pharmacistContext, plan!, escalations, "patient-1"),
      });
    } catch (error) {
      caught = error as PendingEscalationError;
    }

    await escalations.decide({
      escalationId: caught!.escalation.id,
      decidedBy: pharmacistContext.userId,
      status: "rejected",
      rationale: "Finding does not warrant this action.",
    });

    await expect(
      service.run({
        tenantId: pharmacistContext.tenantId,
        type: plan!.workflowType,
        idempotencyKey: "wf-instance-3",
        steps: toSupervisedWorkflowSteps(pharmacistContext, plan!, escalations, "patient-1"),
      }),
    ).rejects.toThrow(EscalationRejectedError);

    expect(handlerRan).toBe(0);
  });

  it("keeps AGL-3's autonomous authorization path unchanged for a step that needs no human approval", async () => {
    let handlerRan = 0;
    const { plan } = buildAgentPlan("WF-005", [{
      agentId: "conversation",
      capabilityName: "route_intent",
      execute: async () => { handlerRan += 1; },
    }]);
    const escalations = new InMemoryEscalationStore();
    const service = new WorkflowService(new InMemoryWorkflowStore());
    const patientContext: RuntimeContext = { ...pharmacistContext, role: "patient" };

    const result = await service.run({
      tenantId: patientContext.tenantId,
      type: plan!.workflowType,
      idempotencyKey: "wf-instance-4",
      steps: toSupervisedWorkflowSteps(patientContext, plan!, escalations, "patient-1"),
    });

    expect(handlerRan).toBe(1);
    expect(result.status).toBe("completed");
  });
});
