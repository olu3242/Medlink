export interface PenetrationAuthorization {
  readonly authorizationId: string;
  readonly approved: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly scope: readonly string[];
  readonly testerIds: readonly string[];
}

export interface PenetrationFinding {
  readonly id: string;
  readonly cvss: number;
  readonly tenantEscape: boolean;
  readonly status: "open" | "remediated" | "retest_passed" | "closed";
  readonly remediationEvidence?: string;
}

export function certifyPenetrationTest(input: {
  authorization: PenetrationAuthorization;
  findings: readonly PenetrationFinding[];
  executedAt: Date;
}): {
  readonly passed: boolean;
  readonly failures: readonly string[];
} {
  const failures: string[] = [];
  if (!input.authorization.approved) failures.push("authorization_missing");
  if (
    input.executedAt < input.authorization.startsAt
    || input.executedAt > input.authorization.endsAt
  ) failures.push("outside_authorized_window");
  if (input.authorization.scope.length === 0) failures.push("scope_missing");
  if (input.authorization.testerIds.length === 0) failures.push("tester_missing");
  for (const finding of input.findings) {
    const unresolved = finding.status === "open" || finding.status === "remediated";
    if (unresolved && finding.cvss >= 9) failures.push(`critical:${finding.id}`);
    if (unresolved && finding.tenantEscape && finding.cvss >= 7) {
      failures.push(`tenant_escape:${finding.id}`);
    }
    if (
      (finding.status === "retest_passed" || finding.status === "closed")
      && !finding.remediationEvidence
    ) failures.push(`closure_evidence_missing:${finding.id}`);
  }
  return { passed: failures.length === 0, failures };
}
