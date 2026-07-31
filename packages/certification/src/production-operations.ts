import type { DeploymentDecision } from "./deployment-orchestration";

export interface OperationalGate {
  readonly engine:
    | "deployment" | "hypercare" | "runbooks" | "support"
    | "business_continuity";
  readonly passed: boolean;
  readonly evidenceSha256: string;
}

export function evaluateProductionOperations(
  deployment: DeploymentDecision,
  gates: readonly OperationalGate[],
): {
  readonly operationallyReady: boolean;
  readonly releaseCompletionNotificationAllowed: boolean;
  readonly certificationEvidenceGenerationAllowed: boolean;
  readonly blockers: readonly string[];
} {
  const required: readonly OperationalGate["engine"][] = [
    "deployment", "hypercare", "runbooks", "support", "business_continuity",
  ];
  const blockers: string[] = [];
  if (deployment.status !== "completed") blockers.push("deployment_incomplete");
  for (const engine of required) {
    const gate = gates.find((item) => item.engine === engine);
    if (!gate) blockers.push(`gate_missing:${engine}`);
    else if (!gate.passed || !/^[a-f0-9]{64}$/i.test(gate.evidenceSha256)) {
      blockers.push(`gate_failed:${engine}`);
    }
  }
  const ready = blockers.length === 0;
  return {
    operationallyReady: ready,
    releaseCompletionNotificationAllowed: ready,
    certificationEvidenceGenerationAllowed: ready,
    blockers,
  };
}
