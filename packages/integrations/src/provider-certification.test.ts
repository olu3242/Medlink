import { describe, expect, it } from "vitest";
import {
  certifyProviders,
  type ProviderCertificationEvidence,
} from "./provider-certification";

describe("production provider certification", () => {
  const now = new Date("2026-07-30T00:00:00Z");
  const complete: ProviderCertificationEvidence = {
    provider: "payment",
    profile: "stripe-primary",
    environment: "production",
    external: true,
    executedAt: new Date("2026-07-29T00:00:00Z"),
    expiresAt: new Date("2026-08-30T00:00:00Z"),
    connectivity: true,
    authentication: true,
    timeout: true,
    retry: true,
    circuitBreaker: true,
    fallback: true,
    auditLogging: true,
  };

  it("passes only complete current external production profiles", () => {
    expect(certifyProviders(["payment"], [complete], now)).toEqual({
      passed: true,
      missing: [],
      failed: [],
    });
  });

  it("distinguishes missing providers from incomplete profiles", () => {
    expect(certifyProviders(
      ["payment", "messaging"],
      [{ ...complete, fallback: false }],
      now,
    )).toEqual({
      passed: false,
      missing: ["messaging"],
      failed: ["payment"],
    });
  });
});
