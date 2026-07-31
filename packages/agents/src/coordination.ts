import type { WorkflowInvoker } from "@medlink/conversation";
import { findAgent } from "./registry";
import type { AgentPlan } from "./planning";

export interface HandoffEvent {
  readonly workflowType: string;
  readonly atStep: string;
  readonly fromAgentId: string | null;
  readonly toAgentId: string;
  readonly requiresHumanApproval: boolean;
}

export interface CoordinationLog {
  record(event: HandoffEvent): Promise<void>;
  listByWorkflowType(workflowType: string): Promise<readonly HandoffEvent[]>;
}

export class InMemoryCoordinationLog implements CoordinationLog {
  private readonly events: HandoffEvent[] = [];

  async record(event: HandoffEvent): Promise<void> {
    this.events.push(event);
  }

  async listByWorkflowType(workflowType: string): Promise<readonly HandoffEvent[]> {
    return this.events.filter((event) => event.workflowType === workflowType);
  }
}

// Deterministic: walks an already-built AgentPlan (AGL-3) in step order and
// emits one HandoffEvent every time the acting agent changes, including the
// first step (fromAgentId null -- a plan's entry point isn't "handed off"
// from another agent within the plan itself; it's triggered by whatever
// invoked the plan). Consecutive steps by the same agent produce no
// duplicate handoff. Each event's requiresHumanApproval is read straight
// from AGL-1's registry, so a consumer (AGL-5's escalation gate) never has
// to re-derive whether a handoff needs human supervision. Pure derivation
// -- it executes nothing and can run ahead of execution to validate a
// plan's coordination shape.
export function deriveHandoffs(plan: AgentPlan): readonly HandoffEvent[] {
  const events: HandoffEvent[] = [];
  let previousAgentId: string | null = null;
  for (const step of plan.steps) {
    if (step.agentId !== previousAgentId) {
      const capability = findAgent(step.agentId)?.capabilities.find(
        (candidate) => candidate.name === step.capabilityName,
      );
      events.push({
        workflowType: plan.workflowType,
        atStep: `${step.agentId}.${step.capabilityName}`,
        fromAgentId: previousAgentId,
        toAgentId: step.agentId,
        requiresHumanApproval: capability?.requiresHumanApproval ?? false,
      });
      previousAgentId = step.agentId;
    }
  }
  return events;
}

// Records every derived handoff BEFORE the plan runs -- coordination is
// logged deterministically ahead of execution, not reconstructed from side
// effects afterward, so the trail is accurate even when AGL-3's
// AgentPlanAuthorizationError halts a later step: the handoff that was
// *attempted* is still on record.
export async function recordPlanHandoffs(
  log: CoordinationLog,
  plan: AgentPlan,
): Promise<readonly HandoffEvent[]> {
  const events = deriveHandoffs(plan);
  for (const event of events) await log.record(event);
  return events;
}

// Wraps an existing WorkflowInvoker (e.g. apps/web/lib/workflow-invoker.ts's
// WorkflowOrchestratorInvoker, the real adapter already connecting the
// Conversation Engine to the Workflow Orchestrator) so that handing a
// canonical workflow off to it is itself a logged, governed handoff. This
// is the literal integration point AGL-4 exists for: a coordination record
// in front of the existing invoker, not a second orchestration stack.
export function coordinatedWorkflowInvoker(
  invoker: WorkflowInvoker,
  log: CoordinationLog,
  fromAgentId: string,
  toAgentId: string,
): WorkflowInvoker {
  return {
    async invoke(input) {
      await log.record({
        workflowType: input.workflowType,
        atStep: "workflow_invocation",
        fromAgentId,
        toAgentId,
        requiresHumanApproval: false,
      });
      return invoker.invoke(input);
    },
  };
}
