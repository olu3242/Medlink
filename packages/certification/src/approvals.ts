export type ApprovalDiscipline = "clinical" | "privacy" | "security" | "operations";

export interface SignedApproval {
  readonly discipline: ApprovalDiscipline;
  readonly approverId: string;
  readonly keyId: string;
  readonly algorithm: "ed25519";
  readonly evidenceSha256: string;
  readonly decision: "approved" | "rejected";
  readonly signedAt: Date;
  readonly expiresAt: Date;
  readonly signature: Uint8Array;
}

export interface ApprovalSignatureVerifier {
  verify(approval: SignedApproval): Promise<boolean>;
}

export class ApprovalRegistry {
  constructor(
    private readonly verifier: ApprovalSignatureVerifier,
    private readonly required: readonly ApprovalDiscipline[] = [
      "clinical", "privacy", "security", "operations",
    ],
  ) {}

  async certify(approvals: readonly SignedApproval[], now: Date): Promise<{
    passed: boolean;
    missing: readonly ApprovalDiscipline[];
    invalid: readonly ApprovalDiscipline[];
  }> {
    const verified = await Promise.all(approvals.map(async (approval) => ({
      approval,
      valid: approval.decision === "approved"
        && approval.expiresAt > now
        && /^[a-f0-9]{64}$/.test(approval.evidenceSha256)
        && await this.verifier.verify(approval),
    })));
    const missing = this.required.filter((discipline) =>
      !approvals.some((approval) => approval.discipline === discipline),
    );
    const invalid = this.required.filter((discipline) =>
      verified.some(({ approval, valid }) =>
        approval.discipline === discipline && !valid,
      ),
    );
    return {
      passed: missing.length === 0
        && invalid.length === 0
        && this.required.every((discipline) =>
          verified.some(({ approval, valid }) =>
            approval.discipline === discipline && valid,
          ),
        ),
      missing,
      invalid,
    };
  }
}
