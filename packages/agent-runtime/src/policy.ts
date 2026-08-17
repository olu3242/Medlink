import type {
  AgentPolicy,
  AgentPolicyDecision,
  AgentTask,
} from "./contracts";

const allowed = new Set([
  "file_scan",
  "ocr",
  "prescription_parse",
  "clinical_warning",
  "route_intent",
  "search_medicine",
  "search_inventory",
  "reserve_inventory",
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
      "action" | "actor" | "capability" | "context" | "engine" | "tenantId"
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
    if (allowed.has(task.action)) return { status: "allowed" };
    return {
      status: "blocked",
      reason: `Action '${task.action}' is not approved for the MVP`,
    };
  }
}
