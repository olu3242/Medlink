import type { RuntimeContext } from "@medlink/runtime";
import { governedAgentCatalog, type AgentIdentity } from "./registry";

export type AgentAuthorizationDenialReason =
  | "agent_not_registered"
  | "agent_retired"
  | "capability_not_declared"
  | "action_not_permitted"
  | "role_not_permitted"
  | "requires_human_approval";

export interface AgentAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: AgentAuthorizationDenialReason;
}

const runtimeActionsByCapability: Readonly<Record<string, readonly string[]>> = {
  "conversation.route_intent": ["route_intent"],
  "ocr.extract_prescription": ["ocr"],
  "medicine-match.search_medicine": ["search_medicine"],
  "clinical-review-assistant.flag_validation_findings": ["clinical_warning"],
  "inventory.search_inventory": ["search_inventory"],
  "reservation-coordinator.reserve_matched_inventory": ["reserve_inventory"],
};

// The Policy layer of the architectural invariant this engine exists to
// enforce:
//   Named Agent -> Capability Governance -> Policy -> RBAC+Tenant ->
//   Canonical Workflow -> Idempotent Transaction -> Outbox/Evidence/Audit
//
// This function only ever grants AUTONOMOUS execution. A capability marked
// requiresHumanApproval can never come back allowed=true here -- that is
// the human-in-the-loop path AGL-5's escalation gate owns instead. RBAC and
// tenant scoping still apply downstream inside the canonical RPC itself
// (every operation in registry.ts's canonicalOperations already enforces
// its own role check and is tenant-scoped by RuntimeContext); this is
// defense-in-depth, not a replacement for it.
export function authorizeAgentCapability(
  context: RuntimeContext,
  agentId: string,
  capabilityName: string,
  catalog: readonly AgentIdentity[] = governedAgentCatalog,
): AgentAuthorizationDecision {
  const agent = catalog.find((candidate) => candidate.id === agentId);
  if (!agent) return { allowed: false, reason: "agent_not_registered" };
  if (agent.status !== "active") return { allowed: false, reason: "agent_retired" };

  const capability = agent.capabilities.find((candidate) => candidate.name === capabilityName);
  if (!capability) return { allowed: false, reason: "capability_not_declared" };

  if (!capability.allowedRoles.includes(context.role)) {
    return { allowed: false, reason: "role_not_permitted" };
  }
  if (capability.requiresHumanApproval) {
    return { allowed: false, reason: "requires_human_approval" };
  }
  return { allowed: true };
}

// Authorizes one concrete runtime task. Unlike autonomous capability
// authorization above, this validates the bounded preparatory action a
// capability may execute (for example, recording advisory clinical
// findings) without confusing that action with the downstream human
// decision it may require. No payment or fulfillment action is mapped.
export function authorizeAgentTask(
  input: {
    readonly agentId: string;
    readonly capabilityName: string;
    readonly action: string;
    readonly role: string;
  },
  catalog: readonly AgentIdentity[] = governedAgentCatalog,
): AgentAuthorizationDecision {
  const agent = catalog.find((candidate) => candidate.id === input.agentId);
  if (!agent) return { allowed: false, reason: "agent_not_registered" };
  if (agent.status !== "active") return { allowed: false, reason: "agent_retired" };
  const capability = agent.capabilities.find(
    (candidate) => candidate.name === input.capabilityName,
  );
  if (!capability) return { allowed: false, reason: "capability_not_declared" };
  if (!capability.allowedRoles.includes(input.role)) {
    return { allowed: false, reason: "role_not_permitted" };
  }
  const actions = runtimeActionsByCapability[`${input.agentId}.${input.capabilityName}`] ?? [];
  if (!actions.includes(input.action)) {
    return { allowed: false, reason: "action_not_permitted" };
  }
  return { allowed: true };
}
