export type ImprovementSource =
  | "support_feedback" | "customer_feedback" | "pharmacist_feedback"
  | "clinician_feedback" | "patient_feedback" | "operational_observation"
  | "incident_lesson" | "audit_finding" | "certification_gap";

export type ImprovementClassification =
  | "hotfix" | "rc1_maintenance" | "operational_improvement"
  | "performance_improvement" | "compliance_improvement"
  | "wave_2_5_candidate" | "strategic_roadmap";

export type ImprovementStage =
  | "observation" | "evidence" | "analysis" | "prioritization" | "approval"
  | "implementation" | "certification" | "deployment" | "measurement"
  | "knowledge_capture";

export interface ImprovementItem {
  readonly id: string;
  readonly tenantId: string;
  readonly source: ImprovementSource;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly tags: readonly string[];
  readonly stage: ImprovementStage;
  readonly evidenceSha256?: string;
  readonly approvalSha256?: string;
  readonly certificationSha256?: string;
}

export function classifyImprovement(item: ImprovementItem): ImprovementClassification {
  if (item.severity === "critical") return "hotfix";
  if (item.source === "certification_gap" || item.source === "audit_finding") {
    return "compliance_improvement";
  }
  if (item.tags.includes("performance")) return "performance_improvement";
  if (item.tags.includes("wave-2.5")) return "wave_2_5_candidate";
  if (item.tags.includes("strategic")) return "strategic_roadmap";
  if (item.source === "incident_lesson" || item.source === "operational_observation") {
    return "operational_improvement";
  }
  return "rc1_maintenance";
}

const lifecycle: readonly ImprovementStage[] = [
  "observation", "evidence", "analysis", "prioritization", "approval",
  "implementation", "certification", "deployment", "measurement",
  "knowledge_capture",
];

export function advanceImprovement(
  item: ImprovementItem,
  next: ImprovementStage,
): ImprovementItem {
  if (lifecycle.indexOf(next) !== lifecycle.indexOf(item.stage) + 1) {
    throw new Error(`Invalid improvement transition: ${item.stage} -> ${next}`);
  }
  if (next === "analysis" && !/^[a-f0-9]{64}$/i.test(item.evidenceSha256 ?? "")) {
    throw new Error("Evidence is required before analysis");
  }
  if (next === "implementation"
    && !/^[a-f0-9]{64}$/i.test(item.approvalSha256 ?? "")) {
    throw new Error("Approval is required before implementation");
  }
  if (next === "deployment"
    && !/^[a-f0-9]{64}$/i.test(item.certificationSha256 ?? "")) {
    throw new Error("Certification is required before deployment");
  }
  return { ...item, stage: next };
}
