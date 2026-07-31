export type RunbookCategory =
  | "deployment" | "rollback" | "database_recovery" | "disaster_recovery"
  | "provider_failure" | "inventory_failure" | "clinical_escalation"
  | "authentication_failure" | "tenant_recovery" | "security_incident"
  | "data_restore" | "certificate_rotation" | "provider_onboarding"
  | "tenant_onboarding" | "pharmacy_onboarding";

export type RunbookStatus = "draft" | "review" | "approved" | "deprecated" | "archived";

export interface Runbook {
  readonly id: string;
  readonly category: RunbookCategory;
  readonly version: string;
  readonly status: RunbookStatus;
  readonly purpose: string;
  readonly scope: string;
  readonly prerequisites: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly executionSteps: readonly string[];
  readonly expectedResults: readonly string[];
  readonly validation: readonly string[];
  readonly rollback: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly approvalEvidenceSha256: string;
  readonly revisionHistory: readonly string[];
}

export function validateRunbook(runbook: Runbook): readonly string[] {
  const missing: string[] = [];
  const text = [
    ["purpose", runbook.purpose],
    ["scope", runbook.scope],
  ] as const;
  for (const [field, value] of text) if (value.trim() === "") missing.push(field);
  const lists = [
    ["prerequisites", runbook.prerequisites],
    ["required_permissions", runbook.requiredPermissions],
    ["execution_steps", runbook.executionSteps],
    ["expected_results", runbook.expectedResults],
    ["validation", runbook.validation],
    ["rollback", runbook.rollback],
    ["evidence", runbook.evidenceRequirements],
    ["revision_history", runbook.revisionHistory],
  ] as const;
  for (const [field, value] of lists) if (value.length === 0) missing.push(field);
  if (runbook.status === "approved"
    && !/^[a-f0-9]{64}$/i.test(runbook.approvalEvidenceSha256)) {
    missing.push("approval");
  }
  return missing;
}

export type RunbookTransition = Readonly<Record<RunbookStatus, readonly RunbookStatus[]>>;

const transitions: RunbookTransition = {
  draft: ["review"],
  review: ["draft", "approved"],
  approved: ["deprecated"],
  deprecated: ["archived"],
  archived: [],
};

export function transitionRunbook(runbook: Runbook, status: RunbookStatus): Runbook {
  if (!transitions[runbook.status].includes(status)) {
    throw new Error(`Invalid runbook transition: ${runbook.status} -> ${status}`);
  }
  const candidate = { ...runbook, status };
  if (status === "approved" && validateRunbook(candidate).length > 0) {
    throw new Error("Runbook approval requirements are incomplete");
  }
  return candidate;
}

export function adviseFromRunbooks(
  query: string,
  runbooks: readonly Runbook[],
): {
  readonly recommendations: readonly string[];
  readonly privilegedExecutionAllowed: false;
} {
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
  const recommendations = runbooks
    .filter((runbook) => runbook.status === "approved")
    .filter((runbook) =>
      terms.some((term) =>
        `${runbook.category} ${runbook.purpose} ${runbook.scope}`
          .toLowerCase().includes(term)
      )
    )
    .map((runbook) => `${runbook.id}@${runbook.version}`);
  return { recommendations, privilegedExecutionAllowed: false };
}
