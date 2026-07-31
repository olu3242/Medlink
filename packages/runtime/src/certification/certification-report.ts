import type { CertificationReport } from "./policy-types";

export function certificationMarkdown(report: CertificationReport): string {
  const lines = [
    "# Runtime Certification Report", "",
    `- Status: ${report.status}`,
    `- Score: ${report.score}`,
    `- Profile: ${report.profile}`,
    `- Executed: ${report.executedAt}`, "",
    "| Policy | Category | Result |", "| --- | --- | --- |",
    ...report.results.map((result) =>
      `| ${result.name} | ${result.category} | ${result.passed ? "PASS" : "FAIL"} |`),
  ];
  if (report.recommendedActions.length) {
    lines.push("", "## Recommended actions", "",
      ...report.recommendedActions.map((action) => `- ${action}`));
  }
  return lines.join("\n");
}
