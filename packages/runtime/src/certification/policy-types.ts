export type PolicyCategory = "runtime" | "security" | "observability" | "data" | "quality";
export type PolicySeverity = "required" | "recommended";
export type CertificationStatus =
  | "enterprise_certified" | "conditionally_certified"
  | "development_ready" | "not_certified";

export interface CertificationEvidence {
  values: Readonly<Record<string, boolean | number | string>>;
}

export interface CertificationPolicy {
  id: string;
  name: string;
  version: string;
  category: PolicyCategory;
  severity: PolicySeverity;
  weight: number;
  requiredEvidence: readonly string[];
  evaluate(evidence: CertificationEvidence): boolean;
  failureMessage: string;
  remediation: string;
}

export interface PolicyResult {
  policyId: string;
  name: string;
  category: PolicyCategory;
  passed: boolean;
  weight: number;
  severity: PolicySeverity;
  message?: string;
  remediation?: string;
}

export interface CertificationProfile {
  id: "development" | "staging" | "production" | "enterprise";
  categories: readonly PolicyCategory[];
  threshold: number;
}

export interface CertificationProvider {
  name: string;
  policies: readonly CertificationPolicy[];
}

export interface CertificationReport {
  score: number;
  status: CertificationStatus;
  profile: CertificationProfile["id"];
  executedAt: string;
  platformVersion: string;
  runtimeVersion: string;
  results: readonly PolicyResult[];
  failedChecks: readonly string[];
  warnings: readonly string[];
  recommendedActions: readonly string[];
}
