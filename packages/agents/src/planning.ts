import type { RuntimeContext } from "@medlink/runtime";
import type { WorkflowInstance, WorkflowStep } from "@medlink/workflows";
import { authorizeAgentCapability, type AgentAuthorizationDenialReason } from "./policy";
import { findCapability } from "./registry";

export interface AgentPlanStep {
  readonly agentId: string;
  readonly capabilityName: string;
  // Identical shape to WorkflowStep.execute -- an AgentPlanStep becomes a
  // real WorkflowStep once authorized (see toWorkflowSteps below), not a
  // parallel execution primitive of its own.
  execute(instance: WorkflowInstance): Promise<Readonly<Record<string, unknown>> | void>;
}

export interface AgentPlan {
  readonly workflowType: string;
  readonly steps: readonly AgentPlanStep[];
}

export interface AgentPlanBuildResult {
  readonly plan?: AgentPlan;
  readonly violations: readonly string[];
}

// The one context-independent check available at build time: every step
// must name a real (agentId, capabilityName) pair declared in AGL-1's
// governed catalog. This cannot check role/tenant/human-approval here --
// those depend on the RuntimeContext of whoever eventually executes the
// plan. Building a plan proves its shape is legitimate (no agent can
// invent a capability that was never registered); authorizing it, in
// toWorkflowSteps below, proves this particular caller, right now, may run
// it.
export function buildAgentPlan(
  workflowType: string,
  steps: readonly AgentPlanStep[],
): AgentPlanBuildResult {
  const violations: string[] = [];
  for (const step of steps) {
    if (!findCapability(step.agentId, step.capabilityName)) {
      violations.push(`${step.agentId}.${step.capabilityName} is not a declared capability`);
    }
  }
  if (violations.length > 0) return { violations };
  return { plan: { workflowType, steps }, violations: [] };
}

export class AgentPlanAuthorizationError extends Error {
  constructor(
    readonly agentId: string,
    readonly capabilityName: string,
    readonly reason: AgentAuthorizationDenialReason,
  ) {
    super(`Agent plan halted: ${agentId}.${capabilityName} denied (${reason})`);
    this.name = "AgentPlanAuthorizationError";
  }
}

// Converts an already-built AgentPlan into WorkflowSteps for the SAME
// WorkflowService this repo's Wave 3 work already ships
// (@medlink/workflows) -- the literal "integrate with the canonical
// ARC/workflow runtime, never build a second one" requirement. Each step is
// re-authorized against `context` immediately before its own handler runs
// (deterministic, in order, one at a time); the first denial throws, which
// WorkflowService.run propagates rather than swallowing, so a denied step
// halts the whole plan (fail-closed) instead of the remaining steps
// silently running out of order or a denied step being skipped.
export function toWorkflowSteps(
  context: RuntimeContext,
  plan: AgentPlan,
): readonly WorkflowStep[] {
  return plan.steps.map((step) => ({
    name: `${step.agentId}.${step.capabilityName}`,
    async execute(instance: WorkflowInstance) {
      const decision = authorizeAgentCapability(context, step.agentId, step.capabilityName);
      if (!decision.allowed) {
        throw new AgentPlanAuthorizationError(step.agentId, step.capabilityName, decision.reason!);
      }
      return step.execute(instance);
    },
  }));
}
