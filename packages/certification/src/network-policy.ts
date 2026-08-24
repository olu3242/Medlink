export type InventorySourceType =
  | "api"
  | "webhook"
  | "scheduled_sync"
  | "csv"
  | "xlsx"
  | "manual";

export interface InventoryFreshnessProfile {
  readonly reference: string;
  readonly sourceType: InventorySourceType;
  readonly maxAgeSeconds: number;
  readonly approvedBy: string;
  readonly approvedAt: Date;
}

export interface InventoryFreshnessEvidence {
  readonly sourceType: InventorySourceType;
  readonly sourceUpdatedAt: Date | null;
  readonly lastSuccessfulSync: Date | null;
  readonly integrationHealth: "healthy" | "degraded" | "failed";
}

export type InventoryFreshnessDecision =
  | { readonly status: "fresh"; readonly deadline: Date }
  | { readonly status: "stale"; readonly deadline: Date }
  | { readonly status: "source_unavailable"; readonly deadline: null }
  | { readonly status: "policy_mismatch" | "never_synchronized"; readonly deadline: null };

export function evaluateInventoryFreshness(
  profile: InventoryFreshnessProfile,
  evidence: InventoryFreshnessEvidence,
  now: Date,
): InventoryFreshnessDecision {
  if (!Number.isInteger(profile.maxAgeSeconds) || profile.maxAgeSeconds <= 0) {
    throw new Error("An owner-approved positive freshness duration is required");
  }
  if (profile.sourceType !== evidence.sourceType) {
    return { status: "policy_mismatch", deadline: null };
  }
  if (evidence.integrationHealth !== "healthy") {
    return { status: "source_unavailable", deadline: null };
  }
  if (!evidence.sourceUpdatedAt || !evidence.lastSuccessfulSync) {
    return { status: "never_synchronized", deadline: null };
  }
  if (evidence.lastSuccessfulSync < evidence.sourceUpdatedAt) {
    return { status: "never_synchronized", deadline: null };
  }
  const deadline = new Date(
    evidence.sourceUpdatedAt.getTime() + profile.maxAgeSeconds * 1_000,
  );
  return { status: deadline > now ? "fresh" : "stale", deadline };
}

export type PartnerRelationshipState = "active" | "suspended" | "inactive" | "terminated";

export function suspensionObligationPolicy(input: {
  readonly relationshipState: PartnerRelationshipState;
  readonly obligationCreatedAt: Date | null;
  readonly suspendedAt: Date | null;
}): { readonly mayCreate: boolean; readonly preserveExisting: boolean } {
  const mayCreate = input.relationshipState === "active";
  const preserveExisting = input.obligationCreatedAt !== null
    && (input.suspendedAt === null || input.obligationCreatedAt <= input.suspendedAt);
  return { mayCreate, preserveExisting };
}

export type InternalPaymentState = "pending" | "authorized" | "captured" | "failed";
export type ProviderPaymentState = "paid" | "failed" | "unconfirmed";

export interface PaymentReconciliationEvidence {
  readonly internalPaymentId: string | null;
  readonly providerTransactionId: string;
  readonly providerEventId: string;
  readonly internalState: InternalPaymentState | null;
  readonly providerState: ProviderPaymentState;
  readonly reservationActive: boolean;
  readonly duplicateProviderTransaction: boolean;
  readonly late: boolean;
}

export type PaymentReconciliationDecision =
  | "apply_provider_success"
  | "apply_provider_failure"
  | "already_converged"
  | "reconciliation_required";

export function reconcilePaymentEvidence(
  evidence: PaymentReconciliationEvidence,
): PaymentReconciliationDecision {
  if (!evidence.internalPaymentId || evidence.duplicateProviderTransaction) {
    return "reconciliation_required";
  }
  if (evidence.providerState === "unconfirmed") {
    return evidence.internalState === "pending"
      ? "already_converged"
      : "reconciliation_required";
  }
  if (evidence.late || !evidence.reservationActive) {
    return "reconciliation_required";
  }
  if (evidence.providerState === "paid") {
    if (evidence.internalState === "captured") return "already_converged";
    if (evidence.internalState === "pending" || evidence.internalState === "authorized") {
      return "apply_provider_success";
    }
    return "reconciliation_required";
  }
  if (evidence.internalState === "failed") return "already_converged";
  if (evidence.internalState === "pending") return "apply_provider_failure";
  return "reconciliation_required";
}

export interface BackupPolicy {
  readonly mechanism: string;
  readonly owner: string;
  readonly frequency: string;
  readonly retention: string;
  readonly restoreProcedure: readonly string[];
  readonly verificationProcedure: readonly string[];
  readonly approvedRpoMinutes: number | null;
  readonly approvedRtoMinutes: number | null;
}

export interface RecoveryPolicy {
  readonly owner: string;
  readonly authoritativeSources: readonly string[];
  readonly restartScenarios: readonly string[];
  readonly replayUsesIdempotencyKeys: boolean;
  readonly providerEvidenceRequired: boolean;
  readonly verificationProcedure: readonly string[];
}

export function validateBackupPolicy(policy: BackupPolicy): readonly string[] {
  const failures: string[] = [];
  if (!policy.mechanism.trim()) failures.push("backup_mechanism_required");
  if (!policy.owner.trim()) failures.push("backup_owner_required");
  if (!policy.frequency.trim()) failures.push("backup_frequency_required");
  if (!policy.retention.trim()) failures.push("backup_retention_required");
  if (policy.restoreProcedure.length === 0) failures.push("restore_procedure_required");
  if (policy.verificationProcedure.length === 0) failures.push("backup_verification_required");
  if (policy.approvedRpoMinutes === null || policy.approvedRtoMinutes === null) {
    failures.push("backup_rpo_rto_owner_decision_required");
  } else if (policy.approvedRpoMinutes <= 0 || policy.approvedRtoMinutes <= 0) {
    failures.push("backup_rpo_rto_invalid");
  }
  return failures;
}

export function validateRecoveryPolicy(policy: RecoveryPolicy): readonly string[] {
  const requiredSources = ["database", "outbox", "workflow", "idempotency", "provider_evidence"];
  const requiredScenarios = [
    "application_restart", "worker_restart", "database_restart",
    "workflow_interruption", "inventory_replay", "payment_callback_replay",
    "notification_retry",
  ];
  const failures: string[] = [];
  if (!policy.owner.trim()) failures.push("recovery_owner_required");
  if (!requiredSources.every((source) => policy.authoritativeSources.includes(source))) {
    failures.push("recovery_authority_incomplete");
  }
  if (!requiredScenarios.every((scenario) => policy.restartScenarios.includes(scenario))) {
    failures.push("recovery_scenarios_incomplete");
  }
  if (!policy.replayUsesIdempotencyKeys) failures.push("recovery_idempotency_required");
  if (!policy.providerEvidenceRequired) failures.push("recovery_provider_evidence_required");
  if (policy.verificationProcedure.length === 0) failures.push("recovery_verification_required");
  return failures;
}
