export type SecurityControl =
  | "owasp_top_10"
  | "sql_injection"
  | "xss"
  | "csrf"
  | "ssrf"
  | "jwt"
  | "session_integrity"
  | "rbac"
  | "tenant_escape"
  | "api_authorization"
  | "secret_scanning"
  | "dependency_scanning"
  | "container_scanning"
  | "sbom"
  | "license_compliance";

export interface SecurityControlEvidence {
  readonly control: SecurityControl;
  readonly passed: boolean;
  readonly artifactSha256: string;
}

export interface VulnerabilityFinding {
  readonly id: string;
  readonly severity: "low" | "moderate" | "high" | "critical";
  readonly resolved: boolean;
}

export function certifyEnterpriseSecurity(
  evidence: readonly SecurityControlEvidence[],
  findings: readonly VulnerabilityFinding[],
): {
  readonly passed: boolean;
  readonly missing: readonly SecurityControl[];
  readonly failed: readonly SecurityControl[];
  readonly blockingFindings: readonly string[];
  readonly reports: readonly [
    "security-report.json",
    "dependency-report.json",
    "sbom.json",
    "vulnerability-report.json",
  ];
} {
  const required: readonly SecurityControl[] = [
    "owasp_top_10", "sql_injection", "xss", "csrf", "ssrf", "jwt",
    "session_integrity", "rbac", "tenant_escape", "api_authorization",
    "secret_scanning", "dependency_scanning", "container_scanning", "sbom",
    "license_compliance",
  ];
  const validHash = (hash: string) => /^[a-f0-9]{64}$/i.test(hash);
  const missing = required.filter((control) =>
    !evidence.some((item) => item.control === control)
  );
  const failed = required.filter((control) =>
    evidence.some((item) =>
      item.control === control && (!item.passed || !validHash(item.artifactSha256))
    ),
  );
  const blockingFindings = findings
    .filter(({ severity, resolved }) => severity === "critical" && !resolved)
    .map(({ id }) => id);
  return {
    passed: missing.length === 0 && failed.length === 0 && blockingFindings.length === 0,
    missing,
    failed,
    blockingFindings,
    reports: [
      "security-report.json",
      "dependency-report.json",
      "sbom.json",
      "vulnerability-report.json",
    ],
  };
}
