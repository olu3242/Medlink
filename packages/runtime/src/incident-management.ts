export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus =
  | "declared"
  | "escalated"
  | "mitigated"
  | "resolved"
  | "closed";

export interface IncidentRecord {
  readonly id: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly impactAssessment: string;
  readonly timeline: readonly string[];
  readonly communications: readonly string[];
  readonly rootCause?: string;
  readonly correctiveActions: readonly string[];
  readonly lessonsLearned?: string;
  readonly alertEvidenceId: string;
}

const transitions: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = {
  declared: ["escalated", "mitigated"],
  escalated: ["mitigated"],
  mitigated: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

export function transitionIncident(
  incident: IncidentRecord,
  status: IncidentStatus,
): IncidentRecord {
  if (!transitions[incident.status].includes(status)) {
    throw new Error(`Invalid incident transition: ${incident.status} -> ${status}`);
  }
  if (
    status === "closed"
    && (
      !incident.rootCause
      || incident.correctiveActions.length === 0
      || !incident.lessonsLearned
      || incident.timeline.length === 0
      || incident.communications.length === 0
    )
  ) throw new Error("Incident closure evidence is incomplete");
  return { ...incident, status };
}
