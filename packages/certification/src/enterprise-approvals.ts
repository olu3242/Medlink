export type EnterpriseApprovalGroup =
  | "engineering_lead"
  | "clinical_lead"
  | "security_lead"
  | "operations_lead"
  | "compliance_officer"
  | "product_owner"
  | "executive_release_authority";

export type EnterpriseApprovalDecision =
  | "approved"
  | "rejected"
  | "changes_requested"
  | "conditional";

export interface EnterpriseApproval {
  readonly group: EnterpriseApprovalGroup;
  readonly approverId: string;
  readonly delegatedBy?: string;
  readonly decision: EnterpriseApprovalDecision;
  readonly comments: string;
  readonly evidenceSha256: string;
  readonly signature: string;
  readonly decidedAt: Date;
  readonly expiresAt: Date;
  readonly conditionsSatisfied: boolean;
}

export function certifyEnterpriseApprovals(
  approvals: readonly EnterpriseApproval[],
  now: Date,
): {
  readonly passed: boolean;
  readonly missing: readonly EnterpriseApprovalGroup[];
  readonly invalid: readonly EnterpriseApprovalGroup[];
} {
  const required: readonly EnterpriseApprovalGroup[] = [
    "engineering_lead", "clinical_lead", "security_lead", "operations_lead",
    "compliance_officer", "product_owner", "executive_release_authority",
  ];
  const valid = (approval: EnterpriseApproval) =>
    (approval.decision === "approved"
      || (approval.decision === "conditional" && approval.conditionsSatisfied))
    && approval.comments.trim() !== ""
    && /^[a-f0-9]{64}$/i.test(approval.evidenceSha256)
    && approval.signature.trim() !== ""
    && approval.decidedAt <= now
    && approval.expiresAt > now
    && (!approval.delegatedBy || approval.delegatedBy !== approval.approverId);
  const missing = required.filter((group) =>
    !approvals.some((approval) => approval.group === group)
  );
  const invalid = required.filter((group) =>
    approvals.some((approval) => approval.group === group)
    && !approvals.some((approval) => approval.group === group && valid(approval))
  );
  return {
    passed:
      missing.length === 0
      && invalid.length === 0
      && required.every((group) =>
        approvals.some((approval) => approval.group === group && valid(approval))
      ),
    missing,
    invalid,
  };
}
