export type ReleaseStage =
  | "development"
  | "integration"
  | "certification"
  | "staging"
  | "release_candidate"
  | "production_approval"
  | "deployment"
  | "post_deployment_validation"
  | "production_certification";

export type MandatoryReleaseGate =
  | "runtime"
  | "live_database"
  | "hosted_rls"
  | "migration"
  | "security"
  | "observability"
  | "clinical"
  | "compliance"
  | "backup"
  | "disaster_recovery"
  | "human_approval";

export interface ReleaseGateEvidence {
  readonly gate: MandatoryReleaseGate;
  readonly passed: boolean;
  readonly evidenceSha256: string;
}

export interface ReleaseContext {
  readonly stage: ReleaseStage;
  readonly type: "standard" | "emergency" | "hotfix";
  readonly frozen: boolean;
  readonly withinMaintenanceWindow: boolean;
  readonly rollbackApproved: boolean;
  readonly gates: readonly ReleaseGateEvidence[];
}

export function evaluateRelease(context: ReleaseContext): {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
} {
  const required: readonly MandatoryReleaseGate[] = [
    "runtime", "live_database", "hosted_rls", "migration", "security",
    "observability", "clinical", "compliance", "backup",
    "disaster_recovery", "human_approval",
  ];
  const blockers: string[] = [];
  if (context.frozen && context.type === "standard") blockers.push("deployment_freeze");
  if (!context.withinMaintenanceWindow && context.type === "standard") {
    blockers.push("outside_maintenance_window");
  }
  if (!context.rollbackApproved) blockers.push("rollback_not_approved");
  for (const gate of required) {
    const evidence = context.gates.find((item) => item.gate === gate);
    if (
      !evidence
      || !evidence.passed
      || !/^[a-f0-9]{64}$/i.test(evidence.evidenceSha256)
    ) blockers.push(`gate_failed:${gate}`);
  }
  return { allowed: blockers.length === 0, blockers };
}

export function nextReleaseStage(stage: ReleaseStage): ReleaseStage | null {
  const stages: readonly ReleaseStage[] = [
    "development", "integration", "certification", "staging",
    "release_candidate", "production_approval", "deployment",
    "post_deployment_validation", "production_certification",
  ];
  return stages[stages.indexOf(stage) + 1] ?? null;
}
