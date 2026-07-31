import type { CertificationPolicy } from "./policy-types";

export function booleanPolicy(input: Omit<CertificationPolicy, "evaluate"> & {
  evidenceKey: string;
}): CertificationPolicy {
  return {
    ...input,
    requiredEvidence: [input.evidenceKey],
    evaluate: (evidence) => evidence.values[input.evidenceKey] === true,
  };
}
