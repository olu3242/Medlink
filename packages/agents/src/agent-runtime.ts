import type { AIGateway } from "@medlink/ai";
import type { RuntimeContext } from "@medlink/runtime";
import { authorizeAgentCapability, type AgentAuthorizationDenialReason } from "./policy";

// AGSDK-01 (narrow slice) -- the one piece of "every agent's runtime"
// this pass actually extracts, because it is the one pattern a real agent
// (Alice) has proven twice over (input guardrail, output guardrail) rather
// than a speculative abstraction guessed from zero real examples. This is
// a reusable FUNCTION, not a forced base class: AliceAgent and AtlasAgent
// both call it, neither inherits from anything. Escalation-raising and
// response-shaping stay in each agent, because that mapping is genuinely
// agent-specific (Alice always has an escalation reason; Atlas, per its
// own spec, needs none) -- forcing every agent through the same
// escalation shape here would be the exact premature generalization this
// narrow pass was scoped to avoid.

export class AgentCapabilityDeniedError extends Error {
  constructor(
    readonly agentId: string,
    readonly capabilityName: string,
    readonly reason: AgentAuthorizationDenialReason,
  ) {
    super(`Agent "${agentId}" denied capability "${capabilityName}" (${reason})`);
    this.name = "AgentCapabilityDeniedError";
  }
}

export interface GovernedCapabilityInvocation {
  readonly promptId: string;
  readonly promptVersion?: string;
  readonly inputs: Readonly<Record<string, string>>;
}

export interface GovernedCapabilityGuardrails {
  readonly checkInput?: (inputs: Readonly<Record<string, string>>) => boolean;
  readonly checkOutput?: (text: string) => boolean;
}

export type GovernedCapabilityResult =
  | { readonly outcome: "answer"; readonly text: string; readonly promptVersionUsed: string; readonly providerId: string }
  | { readonly outcome: "guardrail_input" }
  | { readonly outcome: "guardrail_output"; readonly text: string };

// The shared sequence: authorize (role + capability, via the same
// governed catalog every agent registers into) -> optional input
// guardrail -> AI Gateway invocation (prompt resolution, retries,
// failover, telemetry all already live inside AIGateway itself, not
// duplicated here) -> optional output guardrail. Throws
// AgentCapabilityDeniedError before ever contacting the model if
// authorization fails; returns a discriminated result the caller maps to
// its own domain-specific response/escalation shape.
export async function invokeGovernedCapability(
  context: RuntimeContext,
  gateway: AIGateway,
  agentId: string,
  capabilityName: string,
  invocation: GovernedCapabilityInvocation,
  guardrails: GovernedCapabilityGuardrails = {},
): Promise<GovernedCapabilityResult> {
  const authorization = authorizeAgentCapability(context, agentId, capabilityName);
  if (!authorization.allowed) {
    throw new AgentCapabilityDeniedError(agentId, capabilityName, authorization.reason!);
  }

  if (guardrails.checkInput?.(invocation.inputs)) {
    return { outcome: "guardrail_input" };
  }

  const result = await gateway.invoke(context, {
    promptId: invocation.promptId,
    ...(invocation.promptVersion !== undefined ? { promptVersion: invocation.promptVersion } : {}),
    inputs: invocation.inputs,
  });

  if (guardrails.checkOutput?.(result.result.text)) {
    return { outcome: "guardrail_output", text: result.result.text };
  }

  return {
    outcome: "answer",
    text: result.result.text,
    promptVersionUsed: result.promptVersionUsed,
    providerId: result.providerId,
  };
}
