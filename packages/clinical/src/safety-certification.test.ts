import { describe, expect, it } from "vitest";
import { certifyClinicalSafety } from "./safety-certification";

describe("clinical safety certification", () => {
  const complete = {
    pharmacistReview: true,
    prescriptionIntegrity: true,
    medicationSafety: true,
    duplicateTherapy: true,
    allergyConflict: true,
    contraindication: true,
    overrideAudit: true,
    escalationTracking: true,
    unresolvedCriticalFindings: 0,
  };

  it("generates a pass artifact only for complete safety evidence", () => {
    expect(certifyClinicalSafety(complete)).toEqual({
      status: "pass",
      failures: [],
      artifact: "clinical-certification.json",
    });
  });

  it("fails for missing controls or unresolved critical findings", () => {
    const result = certifyClinicalSafety({
      ...complete,
      contraindication: false,
      unresolvedCriticalFindings: 1,
    });
    expect(result.status).toBe("fail");
    expect(result.failures).toEqual(["contraindication", "critical_findings"]);
  });
});
