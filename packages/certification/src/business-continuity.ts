export type ContinuityDomain =
  | "infrastructure" | "database" | "messaging" | "payments" | "ai"
  | "identity" | "clinical_operations" | "inventory" | "pharmacy_network"
  | "communications" | "support_operations";

export type ContinuityScenario =
  | "database_outage" | "provider_outage" | "messaging_outage"
  | "payment_outage" | "network_partition" | "region_failure"
  | "credential_expiration" | "queue_overload"
  | "clinical_service_degradation" | "tenant_isolation_breach";

export interface RecoveryObjective {
  readonly domain: ContinuityDomain;
  readonly rtoMinutes: number;
  readonly rpoMinutes: number;
  readonly maximumTolerableDowntimeMinutes: number;
}

export interface ContinuityExercise {
  readonly id: string;
  readonly scenario: ContinuityScenario;
  readonly controlled: boolean;
  readonly executedAt: Date;
  readonly recoveredInMinutes: number;
  readonly dataLossMinutes: number;
  readonly validationPassed: boolean;
  readonly evidenceSha256: string;
  readonly domainChecks: Readonly<Record<ContinuityDomain, boolean>>;
}

export function evaluateContinuity(
  exercise: ContinuityExercise,
  objectives: readonly RecoveryObjective[],
): {
  readonly status: "ready" | "degraded";
  readonly score: number;
  readonly blockers: readonly string[];
  readonly dashboard: {
    readonly recoveryReadiness: "ready" | "degraded";
    readonly lastRecoveryTest: Date;
    readonly businessContinuityScore: number;
  };
} {
  const blockers: string[] = [];
  if (!exercise.controlled) blockers.push("simulation_not_controlled");
  if (!exercise.validationPassed) blockers.push("recovery_validation_failed");
  if (!/^[a-f0-9]{64}$/i.test(exercise.evidenceSha256)) {
    blockers.push("exercise_evidence_invalid");
  }
  for (const [domain, passed] of Object.entries(exercise.domainChecks)) {
    if (!passed) blockers.push(`domain_failed:${domain}`);
  }
  for (const objective of objectives) {
    if (exercise.recoveredInMinutes > objective.rtoMinutes) {
      blockers.push(`rto_missed:${objective.domain}`);
    }
    if (exercise.dataLossMinutes > objective.rpoMinutes) {
      blockers.push(`rpo_missed:${objective.domain}`);
    }
    if (exercise.recoveredInMinutes > objective.maximumTolerableDowntimeMinutes) {
      blockers.push(`mtd_exceeded:${objective.domain}`);
    }
  }
  const checks = Object.values(exercise.domainChecks);
  const score = checks.length === 0
    ? 0
    : Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const ready = blockers.length === 0;
  return {
    status: ready ? "ready" : "degraded",
    score,
    blockers,
    dashboard: {
      recoveryReadiness: ready ? "ready" : "degraded",
      lastRecoveryTest: exercise.executedAt,
      businessContinuityScore: score,
    },
  };
}
