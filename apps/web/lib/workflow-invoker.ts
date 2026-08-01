import { WorkflowService, createMedicineSearchStep, type WorkflowStep } from "@medlink/workflows";
import type { MedicineSearchService } from "@medlink/search";
import type { WorkflowInvocationResult, WorkflowInvoker } from "@medlink/conversation";

export class UnsupportedWorkflowTypeError extends Error {
  constructor(readonly workflowType: string) {
    super(`No canonical workflow definition is wired for workflow type '${workflowType}'`);
    this.name = new.target.name;
  }
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
  ) {}

  async invoke(input: {
    readonly organizationId: string;
    readonly conversationId: string;
    readonly workflowType: string;
    readonly idempotencyKey: string;
    readonly context: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInvocationResult> {
    const steps = this.stepsFor(input.workflowType);
    const instance = await this.service.run({
      tenantId: input.organizationId,
      type: input.workflowType,
      idempotencyKey: input.idempotencyKey,
      context: { conversationId: input.conversationId, ...input.context },
      steps,
    });
    return { workflowInstanceId: instance.id, status: instance.status };
  }

  private stepsFor(workflowType: string): readonly WorkflowStep[] {
    if (workflowType === "medicine_search") {
      return [createMedicineSearchStep(this.searchService)];
    }
    throw new UnsupportedWorkflowTypeError(workflowType);
  }
}
