import { describe, expect, it } from "vitest";
import { portfolioDashboard, prioritizePortfolio } from "./enterprise-portfolio";

const item = {
  id: "platform",
  type: "platform" as const,
  ownerId: "cto",
  roadmapProgress: 80,
  investment: 100,
  businessValue: 90,
  dependencies: [],
  capacityRequired: 10,
  certificationStatus: "certified" as const,
  operationalMaturity: 80,
  deliveryVelocity: 70,
  riskExposure: 20,
  technicalDebt: [],
  innovation: false,
};

describe("enterprise portfolio", () => {
  it("prioritizes governed investments and builds executive projections", () => {
    expect(prioritizePortfolio([item])[0]?.id).toBe("platform");
    expect(portfolioDashboard([item]).certifiedItems).toBe(1);
  });
});
