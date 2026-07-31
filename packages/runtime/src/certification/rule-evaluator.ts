import type {
  CertificationEvidence, CertificationPolicy, PolicyResult,
} from "./policy-types";

export function evaluatePolicy(
  policy: CertificationPolicy,
  evidence: CertificationEvidence,
): PolicyResult {
  try {
    const passed = policy.requiredEvidence.every((key) => key in evidence.values)
      && policy.evaluate(evidence);
    return {
      policyId: policy.id,
      name: policy.name,
      category: policy.category,
      passed,
      weight: policy.weight,
      severity: policy.severity,
      ...(!passed ? {
        message: policy.failureMessage,
        remediation: policy.remediation,
      } : {}),
    };
  } catch {
    return {
      policyId: policy.id, name: policy.name, category: policy.category,
      passed: false, weight: policy.weight, severity: policy.severity,
      message: "Policy evaluation failed", remediation: policy.remediation,
    };
  }
}
