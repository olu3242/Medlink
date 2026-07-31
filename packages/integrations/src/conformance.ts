export type Rc1Integration =
  | "ocr"
  | "whatsapp"
  | "payment"
  | "fhir"
  | "hl7"
  | "approved_partner";

export interface ConformanceEvidence {
  readonly integration: Rc1Integration;
  readonly profile: string;
  readonly environment: string;
  readonly artifactSha256: string;
  readonly executedAt: Date;
  readonly passed: boolean;
  readonly external: boolean;
}

export interface ConformanceArtifact extends ConformanceEvidence {
  readonly content: Uint8Array;
  readonly expiresAt?: Date;
}

export async function verifyConformanceArtifacts(
  artifacts: readonly ConformanceArtifact[],
  now: Date,
): Promise<readonly ConformanceEvidence[]> {
  const { createHash } = await import("node:crypto");
  const seen = new Set<string>();
  return artifacts.map((artifact) => {
    const digest = createHash("sha256").update(artifact.content).digest("hex");
    const identity = `${artifact.integration}:${artifact.profile}:${artifact.environment}`;
    const unique = !seen.has(identity);
    seen.add(identity);
    const current = !artifact.expiresAt || artifact.expiresAt > now;
    const passed = artifact.passed
      && artifact.external
      && unique
      && current
      && digest === artifact.artifactSha256;
    return {
      integration: artifact.integration,
      profile: artifact.profile,
      environment: artifact.environment,
      artifactSha256: artifact.artifactSha256,
      executedAt: artifact.executedAt,
      external: artifact.external,
      passed,
    };
  });
}

export class ConformanceRegistry {
  constructor(private readonly approved: readonly Rc1Integration[]) {}

  certify(evidence: readonly ConformanceEvidence[]): {
    readonly passed: boolean;
    readonly missing: readonly Rc1Integration[];
    readonly failed: readonly Rc1Integration[];
  } {
    const missing = this.approved.filter(
      (integration) => !evidence.some((item) =>
        item.integration === integration && item.external),
    );
    const failed = this.approved.filter((integration) =>
      evidence.some((item) =>
        item.integration === integration && item.external && !item.passed),
    );
    return { passed: missing.length === 0 && failed.length === 0, missing, failed };
  }
}
