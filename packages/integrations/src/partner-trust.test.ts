import { describe, expect, it } from "vitest";
import { evaluatePartnerTrust } from "./partner-trust";

describe("ecosystem partner trust", () => {
  it("suspends partners below mandatory trust policy", () => {
    const result = evaluatePartnerTrust({
      id: "partner-1", type: "pharmacy", tenantId: "tenant-1",
      trustLevel: "certified", slaCompliance: 60, apiQuality: 60,
      securityPosture: 60, uptime: 60, operationalIncidents: 5,
      certificationExpiresAt: new Date("2027-01-01T00:00:00Z"),
      auditCompleted: true, evidenceSha256: "b".repeat(64),
    }, new Date("2026-07-30T00:00:00Z"), 80);
    expect(result.status).toBe("suspended");
  });
});
