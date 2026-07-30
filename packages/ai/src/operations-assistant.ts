export type OperationsAdvisory =
  | "trend_summary" | "recurring_incident" | "service_improvement"
  | "runbook_draft" | "certification_regression" | "backlog_priority";

export interface OperationsAssistantRequest {
  readonly tenantId: string;
  readonly advisory: OperationsAdvisory;
  readonly evidenceIds: readonly string[];
  readonly prompt: string;
}

export function authorizeOperationsAdvice(request: OperationsAssistantRequest): {
  readonly accepted: boolean;
  readonly requiresHumanReview: true;
  readonly mayExecutePrivilegedAction: false;
  readonly mayBypassCertification: false;
  readonly blockers: readonly string[];
} {
  const blockers: string[] = [];
  if (request.tenantId.trim() === "") blockers.push("tenant_missing");
  if (request.evidenceIds.length === 0) blockers.push("evidence_missing");
  if (request.prompt.trim() === "") blockers.push("prompt_missing");
  return {
    accepted: blockers.length === 0,
    requiresHumanReview: true,
    mayExecutePrivilegedAction: false,
    mayBypassCertification: false,
    blockers,
  };
}
