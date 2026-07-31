import { describe, expect, it } from "vitest";
import { certifyPenetrationTest } from "./penetration-governance";

describe("penetration test governance", () => {
  const authorization = {
    authorizationId: "auth-1",
    approved: true,
    startsAt: new Date("2026-07-01T00:00:00Z"),
    endsAt: new Date("2026-07-31T23:59:59Z"),
    scope: ["api", "tenant-isolation"],
    testerIds: ["tester-1"],
  };

  it("accepts verified closure inside an authorized scope", () => {
    expect(certifyPenetrationTest({
      authorization,
      executedAt: new Date("2026-07-30T00:00:00Z"),
      findings: [{
        id: "finding-1",
        cvss: 9.1,
        tenantEscape: true,
        status: "closed",
        remediationEvidence: "sha256:evidence",
      }],
    })).toEqual({ passed: true, failures: [] });
  });

  it("blocks unresolved critical and high tenant-escape findings", () => {
    const result = certifyPenetrationTest({
      authorization,
      executedAt: new Date("2026-07-30T00:00:00Z"),
      findings: [
        { id: "critical", cvss: 9.8, tenantEscape: false, status: "open" },
        { id: "escape", cvss: 8.2, tenantEscape: true, status: "remediated" },
      ],
    });
    expect(result.failures).toEqual(["critical:critical", "tenant_escape:escape"]);
  });
});
