export type SuccessWorkflow =
  | "onboarding" | "training" | "renewal" | "adoption_campaign"
  | "feature_announcement" | "health_review" | "executive_business_review";

export interface CustomerSuccessSnapshot {
  readonly tenantId: string;
  readonly onboardingCompletion: number;
  readonly pharmacyAdoption: number;
  readonly hospitalAdoption: number;
  readonly patientActivation: number;
  readonly usageTrend: number;
  readonly featureUtilization: number;
  readonly churnIndicators: number;
  readonly satisfactionScore: number;
}

export function deriveCustomerHealth(snapshot: CustomerSuccessSnapshot): {
  readonly score: number;
  readonly status: "healthy" | "at_risk" | "critical";
  readonly recommendedWorkflows: readonly SuccessWorkflow[];
} {
  const positive = [
    snapshot.onboardingCompletion, snapshot.pharmacyAdoption,
    snapshot.hospitalAdoption, snapshot.patientActivation,
    snapshot.featureUtilization, snapshot.satisfactionScore,
  ].map((value) => Math.max(0, Math.min(100, value)));
  const average = positive.reduce((sum, value) => sum + value, 0) / positive.length;
  const trendAdjustment = Math.max(-20, Math.min(20, snapshot.usageTrend));
  const churnPenalty = Math.max(0, Math.min(100, snapshot.churnIndicators)) * 0.3;
  const score = Math.round(Math.max(0, Math.min(100, average + trendAdjustment - churnPenalty)));
  const recommendedWorkflows: SuccessWorkflow[] = [];
  if (snapshot.onboardingCompletion < 100) recommendedWorkflows.push("onboarding");
  if (snapshot.featureUtilization < 60) recommendedWorkflows.push("adoption_campaign");
  if (snapshot.satisfactionScore < 70) recommendedWorkflows.push("health_review");
  if (snapshot.churnIndicators >= 50) recommendedWorkflows.push("executive_business_review");
  return {
    score,
    status: score >= 75 ? "healthy" : score >= 50 ? "at_risk" : "critical",
    recommendedWorkflows,
  };
}
