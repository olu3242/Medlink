export type GovernanceDomain =
  | "policy"
  | "standard"
  | "control"
  | "operating_procedure"
  | "clinical"
  | "engineering"
  | "security"
  | "release";

export interface GovernanceDocument {
  readonly id: string;
  readonly domain: GovernanceDomain;
  readonly version: number;
  readonly effectiveAt: Date;
  readonly approvedBy: readonly string[];
  readonly supersedesId?: string;
}

export interface PolicyAcknowledgement {
  readonly documentId: string;
  readonly documentVersion: number;
  readonly subjectId: string;
  readonly acknowledgedAt: Date;
}

export interface PolicyException {
  readonly id: string;
  readonly documentId: string;
  readonly approved: boolean;
  readonly approvedBy?: string;
  readonly expiresAt: Date;
  readonly rationale: string;
}

export type ComplianceControl =
  | "audit_logging"
  | "consent"
  | "access_reviews"
  | "privileged_activity"
  | "retention"
  | "encryption"
  | "configuration"
  | "tenant_isolation"
  | "rls"
  | "immutable_audit";

export interface ComplianceControlEvidence {
  readonly control: ComplianceControl;
  readonly passed: boolean;
  readonly artifactSha256: string;
}

export function certifyCompliance(input: {
  documents: readonly GovernanceDocument[];
  acknowledgements: readonly PolicyAcknowledgement[];
  exceptions: readonly PolicyException[];
  evidence: readonly ComplianceControlEvidence[];
  evaluatedAt: Date;
}): {
  readonly passed: boolean;
  readonly failures: readonly string[];
} {
  const failures = new Set<string>();
  const required: readonly ComplianceControl[] = [
    "audit_logging", "consent", "access_reviews", "privileged_activity",
    "retention", "encryption", "configuration", "tenant_isolation", "rls",
    "immutable_audit",
  ];
  const latest = new Map<string, GovernanceDocument>();
  for (const document of input.documents) {
    const prior = latest.get(document.id);
    if (!prior || document.version > prior.version) latest.set(document.id, document);
    if (document.approvedBy.length === 0) failures.add(`unapproved_policy:${document.id}`);
    if (document.effectiveAt > input.evaluatedAt) {
      failures.add(`policy_not_effective:${document.id}`);
    }
  }
  for (const document of latest.values()) {
    if (!input.acknowledgements.some((item) =>
      item.documentId === document.id
      && item.documentVersion === document.version
      && item.acknowledgedAt >= document.effectiveAt
    )) failures.add(`acknowledgement_missing:${document.id}`);
  }
  for (const exception of input.exceptions) {
    if (
      !exception.approved
      || !exception.approvedBy
      || exception.rationale.trim() === ""
      || exception.expiresAt <= input.evaluatedAt
    ) failures.add(`invalid_exception:${exception.id}`);
  }
  for (const control of required) {
    const item = input.evidence.find((candidate) => candidate.control === control);
    if (!item) failures.add(`evidence_missing:${control}`);
    else if (!item.passed || !/^[a-f0-9]{64}$/i.test(item.artifactSha256)) {
      failures.add(`evidence_failed:${control}`);
    }
  }
  return { passed: failures.size === 0, failures: [...failures] };
}
