export type WaveTransitionGate =
  | "wave_registry" | "capability_registry" | "extension_contracts"
  | "sdk_compatibility" | "roadmap_governance" | "rc1_operational_certification"
  | "executive_wave_approval";

export interface WaveTransitionEvidence {
  readonly gate: WaveTransitionGate;
  readonly passed: boolean;
  readonly evidenceSha256: string;
}

export function evaluateWaveTransition(
  targetWaveId: string,
  evidence: readonly WaveTransitionEvidence[],
): {
  readonly frameworkReady: boolean;
  readonly targetWave: string;
  readonly admission: "authorized" | "blocked";
  readonly businessCapabilitiesImplemented: false;
  readonly blockers: readonly string[];
} {
  const required: readonly WaveTransitionGate[] = [
    "wave_registry", "capability_registry", "extension_contracts",
    "sdk_compatibility", "roadmap_governance", "rc1_operational_certification",
    "executive_wave_approval",
  ];
  const blockers = required.flatMap((gate) => {
    const record = evidence.find((item) => item.gate === gate);
    return !record || !record.passed || !/^[a-f0-9]{64}$/i.test(record.evidenceSha256)
      ? [`gate_failed:${gate}`]
      : [];
  });
  const frameworkGates = new Set<WaveTransitionGate>([
    "wave_registry", "capability_registry", "extension_contracts",
    "sdk_compatibility", "roadmap_governance",
  ]);
  const frameworkReady = [...frameworkGates].every((gate) =>
    evidence.some((item) =>
      item.gate === gate
      && item.passed
      && /^[a-f0-9]{64}$/i.test(item.evidenceSha256)
    )
  );
  return {
    frameworkReady,
    targetWave: targetWaveId,
    admission: blockers.length === 0 ? "authorized" : "blocked",
    businessCapabilitiesImplemented: false,
    blockers,
  };
}
