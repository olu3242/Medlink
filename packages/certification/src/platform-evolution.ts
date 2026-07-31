export type EvolutionGate =
  | "portfolio_governance" | "architecture_integrity" | "ai_model_governance"
  | "partner_trust" | "digital_twin" | "rc1_general_availability";

export interface EvolutionEvidence {
  readonly gate: EvolutionGate;
  readonly passed: boolean;
  readonly evidenceSha256: string;
}

export function evaluatePlatformEvolution(
  evidence: readonly EvolutionEvidence[],
): {
  readonly frameworkCertified: boolean;
  readonly productionActivation: "active" | "inactive";
  readonly healthcareWorkflowsIntroduced: false;
  readonly blockers: readonly string[];
} {
  const frameworkGates: readonly EvolutionGate[] = [
    "portfolio_governance", "architecture_integrity", "ai_model_governance",
    "partner_trust", "digital_twin",
  ];
  const valid = (gate: EvolutionGate) => evidence.some((item) =>
    item.gate === gate
    && item.passed
    && /^[a-f0-9]{64}$/i.test(item.evidenceSha256)
  );
  const blockers = [...frameworkGates, "rc1_general_availability" as const]
    .filter((gate) => !valid(gate))
    .map((gate) => `gate_failed:${gate}`);
  return {
    frameworkCertified: frameworkGates.every(valid),
    productionActivation: blockers.length === 0 ? "active" : "inactive",
    healthcareWorkflowsIntroduced: false,
    blockers,
  };
}
