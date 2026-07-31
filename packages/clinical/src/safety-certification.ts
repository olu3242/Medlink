export interface ClinicalSafetyEvidence {
  readonly pharmacistReview: boolean;
  readonly prescriptionIntegrity: boolean;
  readonly medicationSafety: boolean;
  readonly duplicateTherapy: boolean;
  readonly allergyConflict: boolean;
  readonly contraindication: boolean;
  readonly overrideAudit: boolean;
  readonly escalationTracking: boolean;
  readonly unresolvedCriticalFindings: number;
}

export function certifyClinicalSafety(
  evidence: ClinicalSafetyEvidence,
): {
  readonly status: "pass" | "fail";
  readonly failures: readonly string[];
  readonly artifact: "clinical-certification.json";
} {
  const checks: Readonly<Record<string, boolean>> = {
    pharmacist_review: evidence.pharmacistReview,
    prescription_integrity: evidence.prescriptionIntegrity,
    medication_safety: evidence.medicationSafety,
    duplicate_therapy: evidence.duplicateTherapy,
    allergy_conflict: evidence.allergyConflict,
    contraindication: evidence.contraindication,
    override_audit: evidence.overrideAudit,
    escalation_tracking: evidence.escalationTracking,
    critical_findings: evidence.unresolvedCriticalFindings === 0,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return {
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    artifact: "clinical-certification.json",
  };
}
