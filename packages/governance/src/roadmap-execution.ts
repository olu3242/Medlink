export type InitiativeStatus =
  | "proposed" | "architecture_review" | "risk_review" | "approved"
  | "implementation" | "certification" | "rollout" | "measurement" | "closed";

export interface RoadmapInitiative {
  readonly id: string;
  readonly waveId: string;
  readonly businessObjective: string;
  readonly architectureReviewSha256?: string;
  readonly dependencies: readonly string[];
  readonly riskAssessment: readonly string[];
  readonly status: InitiativeStatus;
  readonly certificationRequirements: readonly string[];
  readonly rolloutStrategy: string;
  readonly successMetrics: readonly string[];
  readonly approvalEvidenceSha256?: string;
  readonly certificationEvidenceSha256?: string;
}

const stages: readonly InitiativeStatus[] = [
  "proposed", "architecture_review", "risk_review", "approved",
  "implementation", "certification", "rollout", "measurement", "closed",
];

export function advanceInitiative(
  initiative: RoadmapInitiative,
  next: InitiativeStatus,
): RoadmapInitiative {
  if (stages.indexOf(next) !== stages.indexOf(initiative.status) + 1) {
    throw new Error(`Invalid initiative transition: ${initiative.status} -> ${next}`);
  }
  if (next === "risk_review"
    && !/^[a-f0-9]{64}$/i.test(initiative.architectureReviewSha256 ?? "")) {
    throw new Error("Architecture review is required");
  }
  if (next === "implementation"
    && !/^[a-f0-9]{64}$/i.test(initiative.approvalEvidenceSha256 ?? "")) {
    throw new Error("Initiative approval is required");
  }
  if (next === "rollout"
    && !/^[a-f0-9]{64}$/i.test(initiative.certificationEvidenceSha256 ?? "")) {
    throw new Error("Initiative certification is required");
  }
  if (!initiative.businessObjective || !initiative.rolloutStrategy
    || initiative.certificationRequirements.length === 0
    || initiative.successMetrics.length === 0) {
    throw new Error("Initiative governance metadata is incomplete");
  }
  return { ...initiative, status: next };
}
