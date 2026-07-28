import { certificationStatus, complianceScore } from "./compliance-score";
import type { PolicyRegistry } from "./policy-registry";
import { evaluatePolicy } from "./rule-evaluator";
import type {
  CertificationEvidence, CertificationProfile, CertificationReport,
} from "./policy-types";

export class CertificationEngine {
  private latest?: CertificationReport;
  constructor(
    private readonly registry: PolicyRegistry,
    private readonly versions: { platform: string; runtime: string },
    private readonly now: () => Date = () => new Date(),
  ) {}

  run(evidence: CertificationEvidence, profile: CertificationProfile): CertificationReport {
    const policies = this.registry.policies()
      .filter((policy) => profile.categories.includes(policy.category));
    const results = policies.map((policy) => evaluatePolicy(policy, evidence));
    const score = complianceScore(results);
    const computed = certificationStatus(score);
    const status = score >= profile.threshold ? computed : "not_certified";
    this.latest = {
      score, status, profile: profile.id, executedAt: this.now().toISOString(),
      platformVersion: this.versions.platform, runtimeVersion: this.versions.runtime,
      results,
      failedChecks: results.filter((item) => !item.passed).map((item) => item.policyId),
      warnings: results.filter((item) => !item.passed && item.severity === "recommended")
        .map((item) => item.message ?? item.policyId),
      recommendedActions: [...new Set(results.filter((item) => !item.passed)
        .flatMap((item) => item.remediation ? [item.remediation] : []))],
    };
    return this.latest;
  }

  latestReport(): CertificationReport | undefined {
    return this.latest;
  }
}
