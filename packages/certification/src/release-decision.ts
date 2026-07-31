export interface CertificationGate {
  readonly id: string;
  readonly passed: boolean;
  readonly conditional: boolean;
  readonly evidence: readonly string[];
}

export interface ReleaseDecision {
  readonly status: "approved" | "conditional" | "rejected";
  readonly failed: readonly string[];
  readonly conditional: readonly string[];
}

export function decideRelease(gates: readonly CertificationGate[]): ReleaseDecision {
  const failed = gates.filter((gate) => !gate.passed && !gate.conditional)
    .map((gate) => gate.id);
  const conditional = gates.filter((gate) => gate.conditional || !gate.passed)
    .map((gate) => gate.id);
  return {
    status: failed.length > 0
      ? "rejected"
      : conditional.length > 0
        ? "conditional"
        : "approved",
    failed,
    conditional,
  };
}
