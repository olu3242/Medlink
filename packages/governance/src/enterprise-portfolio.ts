export type PortfolioItemType =
  | "program" | "product" | "platform" | "capability" | "service" | "engine"
  | "workstream" | "strategic_initiative";

export interface PortfolioItem {
  readonly id: string;
  readonly type: PortfolioItemType;
  readonly ownerId: string;
  readonly roadmapProgress: number;
  readonly investment: number;
  readonly businessValue: number;
  readonly dependencies: readonly string[];
  readonly capacityRequired: number;
  readonly certificationStatus: "uncertified" | "degraded" | "certified";
  readonly operationalMaturity: number;
  readonly deliveryVelocity: number;
  readonly riskExposure: number;
  readonly technicalDebt: readonly string[];
  readonly innovation: boolean;
}

export function prioritizePortfolio(items: readonly PortfolioItem[]): readonly {
  readonly id: string;
  readonly priorityScore: number;
}[] {
  const ids = new Set(items.map((item) => item.id));
  for (const item of items) {
    if (!item.ownerId) throw new Error(`Portfolio owner missing: ${item.id}`);
    if (item.dependencies.some((dependency) => !ids.has(dependency))) {
      throw new Error(`Portfolio dependency missing: ${item.id}`);
    }
  }
  return items.map((item) => ({
    id: item.id,
    priorityScore: Math.round(
      item.businessValue * 0.4
      + (100 - item.riskExposure) * 0.2
      + item.operationalMaturity * 0.2
      + item.deliveryVelocity * 0.2,
    ),
  })).sort((left, right) => right.priorityScore - left.priorityScore);
}

export function portfolioDashboard(items: readonly PortfolioItem[]) {
  const totalInvestment = items.reduce((sum, item) => sum + item.investment, 0);
  const average = (values: readonly number[]) =>
    values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  return {
    roadmapProgress: average(items.map((item) => item.roadmapProgress)),
    investmentAllocation: totalInvestment,
    certifiedItems: items.filter((item) => item.certificationStatus === "certified").length,
    operationalMaturity: average(items.map((item) => item.operationalMaturity)),
    deliveryVelocity: average(items.map((item) => item.deliveryVelocity)),
    riskExposure: average(items.map((item) => item.riskExposure)),
  };
}
