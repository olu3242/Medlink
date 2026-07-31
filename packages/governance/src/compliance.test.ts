import { describe, expect, it } from "vitest";
import {
  certifyCompliance,
  type ComplianceControl,
} from "./compliance";

describe("enterprise compliance and governance", () => {
  const controls: readonly ComplianceControl[] = [
    "audit_logging", "consent", "access_reviews", "privileged_activity",
    "retention", "encryption", "configuration", "tenant_isolation", "rls",
    "immutable_audit",
  ];
  const now = new Date("2026-07-30T00:00:00Z");

  it("requires approved effective acknowledged policy and hashed control evidence", () => {
    const result = certifyCompliance({
      documents: [{
        id: "security-policy",
        domain: "security",
        version: 2,
        effectiveAt: new Date("2026-07-01T00:00:00Z"),
        approvedBy: ["compliance-lead"],
      }],
      acknowledgements: [{
        documentId: "security-policy",
        documentVersion: 2,
        subjectId: "operator",
        acknowledgedAt: new Date("2026-07-02T00:00:00Z"),
      }],
      exceptions: [],
      evidence: controls.map((control) => ({
        control,
        passed: true,
        artifactSha256: "a".repeat(64),
      })),
      evaluatedAt: now,
    });
    expect(result).toEqual({ passed: true, failures: [] });
  });

  it("rejects stale acknowledgements, invalid waivers, and missing controls", () => {
    const result = certifyCompliance({
      documents: [{
        id: "release-policy",
        domain: "release",
        version: 2,
        effectiveAt: new Date("2026-07-01T00:00:00Z"),
        approvedBy: [],
      }],
      acknowledgements: [{
        documentId: "release-policy",
        documentVersion: 1,
        subjectId: "operator",
        acknowledgedAt: now,
      }],
      exceptions: [{
        id: "waiver-1",
        documentId: "release-policy",
        approved: false,
        expiresAt: now,
        rationale: "",
      }],
      evidence: [],
      evaluatedAt: now,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "unapproved_policy:release-policy",
      "acknowledgement_missing:release-policy",
      "invalid_exception:waiver-1",
      "evidence_missing:rls",
    ]));
  });
});
