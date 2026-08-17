import type {
  AgentPolicy,
  AgentPolicyDecision,
  AgentTask,
} from "./contracts";
import { authorizeAgentTask } from "@medlink/agents";

const legacyTaskBindings = new Set([
  "prescription-reader:ML-CAP-006:file_scan:patient",
  "prescription-reader:ML-CAP-006:prescription_parse:service_account",
]);

const pharmacistReview = new Map([
  ["generic_substitution", "A pharmacist must approve generic substitution"],
  ["clinical_recommendation", "A pharmacist must approve clinical recommendations"],
  ["prescription_approval", "Only a pharmacist may approve a prescription"],
  ["clarification_resolution", "A pharmacist must resolve clinical clarification"],
]);

export class MvpAgentPolicy implements AgentPolicy {
  evaluate(
    task: Pick<
      AgentTask<unknown, unknown>,
      | "action"
      | "actor"
      | "agentId"
      | "capability"
      | "context"
      | "engine"
      | "persona"
      | "requiresHumanApproval"
      | "tenantId"
    >,
  ): AgentPolicyDecision {
    if (task.context.tenantId !== task.tenantId) {
      return { status: "blocked", reason: "Task context tenant mismatch" };
    }
    const reason = pharmacistReview.get(task.action);
    if (reason) {
      return {
        status: "requires_human_review",
        approver: "pharmacist",
        reason,
      };
    }
    if (!task.agentId || !task.persona) {
      return { status: "blocked", reason: "Agent identity and persona are required" };
    }
    const legacyKey = `${task.agentId}:${task.capability}:${task.action}:${task.persona}`;
    if (legacyTaskBindings.has(legacyKey)) return { status: "allowed" };
    const authorization = authorizeAgentTask({
      agentId: task.agentId,
      capabilityName: task.capability,
      action: task.action,
      role: task.persona,
    });
    if (authorization.allowed) return { status: "allowed" };
    return {
      status: "blocked",
      reason: `Agent task is not approved for the MVP (${authorization.reason})`,
    };
  }
}
