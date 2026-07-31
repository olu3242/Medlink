import { describe, expect, it } from "vitest";
import { deriveCustomerHealth } from "./customer-success";

describe("customer success", () => {
  it("turns tenant-scoped adoption signals into governed workflows", () => {
    const result = deriveCustomerHealth({
      tenantId: "tenant-1",
      onboardingCompletion: 70,
      pharmacyAdoption: 50,
      hospitalAdoption: 50,
      patientActivation: 60,
      usageTrend: -10,
      featureUtilization: 40,
      churnIndicators: 80,
      satisfactionScore: 50,
    });
    expect(result.status).toBe("critical");
    expect(result.recommendedWorkflows).toContain("executive_business_review");
  });
});
