import { describe, expect, it } from "vitest";
import {
  ApprovalRegistry,
  type ApprovalDiscipline,
  type SignedApproval,
} from "./approvals";

const disciplines: ApprovalDiscipline[] = [
  "clinical", "privacy", "security", "operations",
];

function approval(discipline: ApprovalDiscipline): SignedApproval {
  return {
    discipline,
    approverId: `approver-${discipline}`,
    keyId: `key-${discipline}`,
    algorithm: "ed25519",
    evidenceSha256: "a".repeat(64),
    decision: "approved",
    signedAt: new Date("2026-07-29"),
    expiresAt: new Date("2027-07-29"),
    signature: new Uint8Array([1]),
  };
}

describe("signed approval registry", () => {
  it("requires valid clinical, privacy, security, and operations signatures", async () => {
    const result = await new ApprovalRegistry({
      verify: async (value) => value.signature.length > 0,
    }).certify(disciplines.map(approval), new Date("2026-07-30"));
    expect(result).toEqual({ passed: true, missing: [], invalid: [] });
  });

  it("fails closed on missing or expired approval", async () => {
    const expired = {
      ...approval("security"),
      expiresAt: new Date("2026-01-01"),
    };
    const result = await new ApprovalRegistry({
      verify: async () => true,
    }).certify([approval("clinical"), approval("privacy"), expired], new Date("2026-07-30"));
    expect(result).toMatchObject({
      passed: false,
      missing: ["operations"],
      invalid: ["security"],
    });
  });
});
