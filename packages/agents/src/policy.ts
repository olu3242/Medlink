import type { RuntimeContext } from "@medlink/runtime";
import { governedAgentCatalog, type AgentIdentity } from "./registry";

export type AgentAuthorizationDenialReason =
  | "agent_not_registered"
  | "agent_retired"
  | "capability_not_declared"
  | "role_not_permitted"
  | "requires_human_approval";

export interface AgentAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: AgentAuthorizationDenialReason;
}

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
