import { WorkflowService, createMedicineSearchStep, type WorkflowStep } from "@medlink/workflows";
import type { MedicineSearchService } from "@medlink/search";
import type { WorkflowInvocationResult, WorkflowInvoker } from "@medlink/conversation";

export class UnsupportedWorkflowTypeError extends Error {
  constructor(readonly workflowType: string) {
    super(`No canonical workflow definition is wired for workflow type '${workflowType}'`);
    this.name = new.target.name;
  }
}

export function medicineSearchTerm(messageBody: string): string {
  const trimmed = messageBody.trim();
  return trimmed.replace(
    /^(?:find|search(?:\s+for)?|looking\s+for|need\s+(?:medicine|medication))\s+/i,
    "",
  ).trim();
}

// Adapts packages/workflows' WorkflowService to packages/conversation's
// WorkflowInvoker port -- the connection ADR 0003's diagram draws between
// the Conversation Engine and the Workflow Orchestrator. Only
// "medicine_search" (WF-005) has a real, executable step set as of this
// pass; packages/workflows/src/definitions.ts documents all 15 canonical
// workflows structurally, but most don't have executable steps behind
// them yet. An intent KeywordIntentClassifier can produce that this
// adapter has no steps for throws UnsupportedWorkflowTypeError rather than
// silently succeeding with no work done -- callers (a future webhook
// route, once ADR 0004 is accepted) must handle that rather than assume
// every classified intent is runnable today.
export class WorkflowOrchestratorInvoker implements WorkflowInvoker {
  constructor(
    private readonly service: WorkflowService,
    private readonly searchService: MedicineSearchService,
    private readonly executor?: AgentTaskExecutor,
  ) {}

  async invoke(input: {
    readonly organizationId: string;
    readonly conversationId: string;
    readonly workflowType: string;
    readonly idempotencyKey: string;
    readonly context: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInvocationResult> {
    const steps = this.stepsFor(input.workflowType);
    const context = input.workflowType === "medicine_search"
      && typeof input.context.term !== "string"
      && typeof input.context.messageBody === "string"
      ? { ...input.context, term: medicineSearchTerm(input.context.messageBody) }
      : input.context;
    const invoke = async () => {
      const instance = await this.service.run({
        tenantId: input.organizationId,
        type: input.workflowType,
        idempotencyKey: input.idempotencyKey,
        context: { conversationId: input.conversationId, ...context },
        steps,
      });
      return { workflowInstanceId: instance.id, status: instance.status };
    };
    if (!this.executor) return invoke();

    const patientId = typeof input.context.patientId === "string"
      ? input.context.patientId
      : undefined;
    const route = routeAgent({
      workflowType: "medication_access",
      workflowState: "intent_routed",
      requiredCapability: "conversation.intent",
      persona: "patient",
      tenantId: input.organizationId,
    });
    const taskContext: {
      tenantId: string;
      patientId?: string;
      conversationId: string;
      workflowId?: string;
    } = {
      tenantId: input.organizationId,
      ...(patientId ? { patientId } : {}),
      conversationId: input.conversationId,
    };
    const result = await this.executor.execute({
      id: `${input.idempotencyKey}:conversation-route`,
      engine: "ML-ENG-013",
      capability: route.capabilityName,
      action: "route_intent",
      actor: patientId ?? "system",
      tenantId: input.organizationId,
      correlationId: input.idempotencyKey,
      agentId: route.agentId,
      agentVersion: route.agentVersion,
      persona: "patient",
      requiresHumanApproval: route.requiresHumanApproval,
      context: taskContext,
      input: { workflowType: input.workflowType },
      execute: async () => {
        const invoked = await invoke();
        taskContext.workflowId = invoked.workflowInstanceId;
        return invoked;
      },
    });
    if (result.status !== "completed") throw new Error("Unexpected human gate");
    return result.output;
  }

  private stepsFor(workflowType: string): readonly WorkflowStep[] {
    if (workflowType === "medicine_search") {
      return [createMedicineSearchStep(this.searchService)];
    }
    throw new UnsupportedWorkflowTypeError(workflowType);
  }
}
import { AgentTaskExecutor } from "@medlink/agent-runtime";
import { routeAgent } from "@medlink/agents";
