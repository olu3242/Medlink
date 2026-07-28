import type { CertificationStatus, PolicyResult } from "./policy-types";

export function complianceScore(results: readonly PolicyResult[]): number {
  const total = results.reduce((sum, result) => sum + result.weight, 0);
  if (total === 0) return 0;
  const passed = results.filter((result) => result.passed)
    .reduce((sum, result) => sum + result.weight, 0);
  return Math.round((passed / total) * 100);
}

export function certificationStatus(score: number): CertificationStatus {
  if (score >= 95) return "enterprise_certified";
  if (score >= 85) return "conditionally_certified";
  if (score >= 70) return "development_ready";
  return "not_certified";
}
