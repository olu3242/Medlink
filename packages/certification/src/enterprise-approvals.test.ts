import { describe, expect, it } from "vitest";
import {
  certifyEnterpriseApprovals,
  type EnterpriseApprovalGroup,
} from "./enterprise-approvals";

describe("enterprise human approvals", () => {
  const groups: readonly EnterpriseApprovalGroup[] = [
    "engineering_lead", "clinical_lead", "security_lead", "operations_lead",
    "compliance_officer", "product_owner", "executive_release_authority",
  ];
  const now = new Date("2026-07-30T00:00:00Z");

  it("requires all seven current signed approval groups", () => {
    const result = certifyEnterpriseApprovals(groups.map((group) => ({
      group,
      approverId: `${group}-approver`,
      decision: "approved",
      comments: "Approved against linked evidence.",
      evidenceSha256: "a".repeat(64),
      signature: "signed",
      decidedAt: new Date("2026-07-29T00:00:00Z"),
      expiresAt: new Date("2026-08-30T00:00:00Z"),
      conditionsSatisfied: true,
    })), now);
    expect(result).toEqual({ passed: true, missing: [], invalid: [] });
  });

  it("rejects expired, rejected, or unsatisfied conditional approvals", () => {
    const result = certifyEnterpriseApprovals([
      {
        group: "engineering_lead",
        approverId: "engineering",
        decision: "conditional",
        comments: "Resolve finding.",
        evidenceSha256: "a".repeat(64),
        signature: "signed",
        decidedAt: new Date("2026-07-29T00:00:00Z"),
        expiresAt: new Date("2026-08-30T00:00:00Z"),
        conditionsSatisfied: false,
      },
    ], now);
    expect(result.passed).toBe(false);
    expect(result.invalid).toEqual(["engineering_lead"]);
    expect(result.missing).toContain("clinical_lead");
  });
});
