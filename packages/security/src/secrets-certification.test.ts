import { describe, expect, it } from "vitest";
import { certifySecrets, type SecretEvidence } from "./secrets-certification";

describe("production secrets certification", () => {
  const now = new Date("2026-07-30T00:00:00Z");
  const valid: SecretEvidence = {
    name: "PAYMENT_KEY",
    environment: "production",
    source: "github_actions",
    present: true,
    validation: "valid",
    expiresAt: new Date("2026-09-01T00:00:00Z"),
    lastRotatedAt: new Date("2026-07-15T00:00:00Z"),
    rotationDays: 30,
    plaintextInRepository: false,
    leaked: false,
  };

  it("passes current externally stored and validated credentials", () => {
    expect(certifySecrets([valid], ["PAYMENT_KEY"], now)).toMatchObject({
      passed: true,
      failures: [],
    });
  });

  it("blocks missing, invalid, expired, leaked, and plaintext credentials", () => {
    const result = certifySecrets([{
      ...valid,
      validation: "invalid",
      expiresAt: new Date("2026-07-01T00:00:00Z"),
      plaintextInRepository: true,
      leaked: true,
    }], ["PAYMENT_KEY", "MESSAGING_KEY"], now);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "invalid:production:PAYMENT_KEY",
      "expired:production:PAYMENT_KEY",
      "plaintext:production:PAYMENT_KEY",
      "leaked:production:PAYMENT_KEY",
      "missing:production:MESSAGING_KEY",
    ]));
  });
});
