export type SimulationDimension =
  | "patient_demand" | "pharmacy_growth" | "inventory_shortage"
  | "supply_chain_disruption" | "ai_workload" | "infrastructure_scaling"
  | "regional_expansion" | "disaster" | "policy_change" | "wave_rollout";

export interface SimulationScenario {
  readonly id: string;
  readonly dimensions: readonly SimulationDimension[];
  readonly baseline: Readonly<Record<string, number>>;
  readonly changes: Readonly<Record<string, number>>;
  readonly modelVersion: string;
  readonly evidenceSha256: string;
}

export function simulateEnterpriseScenario(scenario: SimulationScenario): {
  readonly forecast: Readonly<Record<string, number>>;
  readonly costForecast: number;
  readonly capacityDelta: number;
  readonly certificationImpact: "review_required";
  readonly advisoryOnly: true;
  readonly productionMutationAllowed: false;
} {
  if (!/^\d+\.\d+\.\d+$/.test(scenario.modelVersion)
    || !/^[a-f0-9]{64}$/i.test(scenario.evidenceSha256)) {
    throw new Error("Versioned simulation evidence is required");
  }
  const forecast = Object.fromEntries(Object.entries(scenario.baseline).map(
    ([key, value]) => [key, value + (scenario.changes[key] ?? 0)],
  ));
  const capacityDelta = Object.values(scenario.changes)
    .reduce((sum, value) => sum + value, 0);
  return {
    forecast,
    costForecast: Math.max(0, capacityDelta * 10),
    capacityDelta,
    certificationImpact: "review_required",
    advisoryOnly: true,
    productionMutationAllowed: false,
  };
}
