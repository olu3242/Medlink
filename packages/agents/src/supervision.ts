import type { RuntimeContext } from "@medlink/runtime";
import type { WorkflowInstance, WorkflowStep } from "@medlink/workflows";
import { authorizeAgentCapability } from "./policy";
import { AgentPlanAuthorizationError, type AgentPlan } from "./planning";
import { findCapability } from "./registry";

export type EscalationStatus = "pending" | "approved" | "rejected";

export interface AgentEscalation {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly capabilityName: string;
  readonly workflowType: string;
  readonly subjectId: string;
  readonly status: EscalationStatus;
  readonly decidedBy?: string;
  readonly decisionRationale?: string;
}

export interface RaiseEscalationInput {
  readonly organizationId: string;
  readonly agentId: string;
  readonly capabilityName: string;
  readonly workflowType: string;
  readonly subjectId: string;
  readonly idempotencyKey: string;
}

export interface DecideEscalationInput {
  readonly escalationId: string;
  readonly decidedBy: string;
  readonly status: "approved" | "rejected";
  readonly rationale: string;
}

export interface EscalationStore {
  raise(input: RaiseEscalationInput): Promise<AgentEscalation>;
  decide(input: DecideEscalationInput): Promise<AgentEscalation>;
  find(escalationId: string): Promise<AgentEscalation | null>;
}

export class PendingEscalationError extends Error {
  constructor(readonly escalation: AgentEscalation) {
    super(
      `Agent plan halted: ${escalation.agentId}.${escalation.capabilityName} is awaiting human approval (escalation ${escalation.id})`,
    );
    this.name = "PendingEscalationError";
  }
}

export class EscalationRejectedError extends Error {
  constructor(readonly escalation: AgentEscalation) {
    super(
      `Agent plan halted: ${escalation.agentId}.${escalation.capabilityName} was rejected by a human reviewer (escalation ${escalation.id})`,
    );
    this.name = "EscalationRejectedError";
  }
}

// A real (if minimal) in-memory EscalationStore -- idempotent on
// (organizationId, idempotencyKey) for raise(), and idempotent-replay-safe
// for decide() the same way migration 202607310002's decide_agent_escalation
// RPC is: a repeated call with the same decider/status/rationale on an
// already-decided escalation returns the existing row; anything else
// targeting an already-decided escalation throws.
export class InMemoryEscalationStore implements EscalationStore {
  private readonly byId = new Map<string, AgentEscalation>();
  private readonly byIdempotencyKey = new Map<string, string>();
  private nextId = 1;

  async raise(input: RaiseEscalationInput): Promise<AgentEscalation> {
    const compositeKey = `${input.organizationId}::${input.idempotencyKey}`;
    const existingId = this.byIdempotencyKey.get(compositeKey);
    if (existingId) return this.byId.get(existingId)!;

    const escalation: AgentEscalation = {
      id: `escalation-${this.nextId++}`,
      organizationId: input.organizationId,
      agentId: input.agentId,
      capabilityName: input.capabilityName,
      workflowType: input.workflowType,
      subjectId: input.subjectId,
      status: "pending",
    };
    this.byId.set(escalation.id, escalation);
    this.byIdempotencyKey.set(compositeKey, escalation.id);
    return escalation;
  }

  async decide(input: DecideEscalationInput): Promise<AgentEscalation> {
    const existing = this.byId.get(input.escalationId);
    if (!existing) throw new Error(`No escalation '${input.escalationId}'`);
    if (existing.status !== "pending") {
      if (
        existing.status === input.status &&
        existing.decidedBy === input.decidedBy &&
        existing.decisionRationale === input.rationale
      ) {
        return existing;
      }
      throw new Error("Agent escalation has already been decided");
    }
    const updated: AgentEscalation = {
      ...existing,
      status: input.status,
      decidedBy: input.decidedBy,
      decisionRationale: input.rationale,
    };
    this.byId.set(updated.id, updated);
    return updated;
  }

  async find(escalationId: string): Promise<AgentEscalation | null> {
    return this.byId.get(escalationId) ?? null;
  }
}

// Supersedes AGL-3's toWorkflowSteps for any plan that may contain a
// requiresHumanApproval step: instead of throwing a one-shot
// AgentPlanAuthorizationError, such a step raises (or finds the existing,
// idempotent) durable AgentEscalation first, then blocks strictly according
// to that escalation's actual status. The step's own handler runs ONLY
// once a human has recorded "approved" -- "pending" and "rejected" both
// halt the plan, the same fail-closed posture AGL-3 established, now
// backed by an auditable, resumable record instead of a bare exception.
// Steps that don't require human approval keep AGL-3's exact
// autonomous-authorization path unchanged.
export function toSupervisedWorkflowSteps(
  context: RuntimeContext,
  plan: AgentPlan,
  escalations: EscalationStore,
  subjectId: string,
): readonly WorkflowStep[] {
  return plan.steps.map((step, index) => ({
    name: `${step.agentId}.${step.capabilityName}`,
    async execute(instance: WorkflowInstance) {
      const capability = findCapability(step.agentId, step.capabilityName);
      if (capability?.requiresHumanApproval) {
        const escalation = await escalations.raise({
          organizationId: context.organizationId,
          agentId: step.agentId,
          capabilityName: step.capabilityName,
          workflowType: plan.workflowType,
          subjectId,
          idempotencyKey: `${instance.id}:${step.agentId}.${step.capabilityName}:${index}`,
        });
        if (escalation.status === "pending") throw new PendingEscalationError(escalation);
        if (escalation.status === "rejected") throw new EscalationRejectedError(escalation);
        return step.execute(instance);
      }

      const decision = authorizeAgentCapability(context, step.agentId, step.capabilityName);
      if (!decision.allowed) {
        throw new AgentPlanAuthorizationError(step.agentId, step.capabilityName, decision.reason!);
      }
      return step.execute(instance);
    },
  }));
}
