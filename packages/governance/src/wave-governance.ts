export type WaveAdmissionStatus =
  | "proposed" | "planning" | "blocked" | "eligible" | "authorized"
  | "active" | "exit_review" | "completed";

export interface GovernedWave {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly ownerId: string;
  readonly dependencies: readonly string[];
  readonly admissionStatus: WaveAdmissionStatus;
  readonly admissionCriteria: readonly string[];
  readonly exitCriteria: readonly string[];
  readonly certificationRequirements: readonly string[];
  readonly changeHistory: readonly string[];
  readonly operationalCertificationEvidenceSha256?: string;
  readonly executiveApprovalEvidenceSha256?: string;
}

export function validateWave(wave: GovernedWave): readonly string[] {
  const issues: string[] = [];
  if (!/^wave-\d+(?:\.\d+)?$/i.test(wave.id)) issues.push("wave_id_invalid");
  if (!wave.ownerId) issues.push("owner_missing");
  if (wave.admissionCriteria.length === 0) issues.push("admission_criteria_missing");
  if (wave.exitCriteria.length === 0) issues.push("exit_criteria_missing");
  if (wave.certificationRequirements.length === 0) {
    issues.push("certification_requirements_missing");
  }
  if (wave.dependencies.includes(wave.id)) issues.push("self_dependency");
  if (wave.changeHistory.length === 0) issues.push("change_history_missing");
  return issues;
}

export function authorizeWave(wave: GovernedWave): GovernedWave {
  if (wave.admissionStatus !== "eligible") {
    throw new Error("Wave must be eligible before authorization");
  }
  if (validateWave(wave).length > 0) throw new Error("Wave registry entry is invalid");
  if (!/^[a-f0-9]{64}$/i.test(
    wave.operationalCertificationEvidenceSha256 ?? "",
  )) throw new Error("Operational certification evidence is required");
  if (!/^[a-f0-9]{64}$/i.test(
    wave.executiveApprovalEvidenceSha256 ?? "",
  )) throw new Error("Executive approval evidence is required");
  return { ...wave, admissionStatus: "authorized" };
}
