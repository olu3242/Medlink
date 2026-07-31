export type ModelLifecycle =
  | "development" | "evaluation" | "clinical_review" | "security_review"
  | "certification" | "deployment" | "monitoring" | "retirement";

export interface GovernedModel {
  readonly id: string;
  readonly modelVersion: string;
  readonly provider: string;
  readonly promptVersion: string;
  readonly evaluationDatasetVersion: string;
  readonly lifecycle: ModelLifecycle;
  readonly approvalHistory: readonly string[];
  readonly deploymentHistory: readonly string[];
  readonly rollbackHistory: readonly string[];
  readonly certificationEvidenceSha256?: string;
}

export interface ModelMonitoring {
  readonly accuracy: number;
  readonly drift: number;
  readonly latencyMs: number;
  readonly cost: number;
  readonly hallucinationReports: number;
  readonly overrideRate: number;
  readonly userFeedback: number;
  readonly confidenceCalibration: number;
}

export function evaluateModelGovernance(
  model: GovernedModel,
  monitoring: ModelMonitoring,
): {
  readonly deployable: boolean;
  readonly rollbackRequired: boolean;
  readonly blockers: readonly string[];
} {
  const blockers: string[] = [];
  if (!/^\d+\.\d+\.\d+$/.test(model.modelVersion)) blockers.push("model_version");
  if (!/^\d+\.\d+\.\d+$/.test(model.promptVersion)) blockers.push("prompt_version");
  if (model.approvalHistory.length === 0) blockers.push("approval_history");
  if (!/^[a-f0-9]{64}$/i.test(model.certificationEvidenceSha256 ?? "")) {
    blockers.push("certification");
  }
  if (monitoring.accuracy < 0.8) blockers.push("accuracy");
  if (monitoring.drift > 0.1) blockers.push("drift");
  if (monitoring.confidenceCalibration < 0.8) blockers.push("calibration");
  return {
    deployable: blockers.length === 0
      && (model.lifecycle === "certification" || model.lifecycle === "deployment"),
    rollbackRequired: model.lifecycle === "monitoring"
      && (monitoring.drift > 0.1 || monitoring.accuracy < 0.8),
    blockers,
  };
}

export interface GovernedAiRecommendation {
  readonly confidence: number;
  readonly supportingEvidence: readonly string[];
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly affectedCapabilities: readonly string[];
  readonly certificationImpact: string;
  readonly rollbackStrategy: string;
  readonly humanApprovalRequired: true;
  readonly advisoryOnly: true;
}
