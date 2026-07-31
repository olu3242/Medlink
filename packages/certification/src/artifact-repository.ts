import { createHash } from "node:crypto";

export type CertificationArtifactCategory =
  | "runtime" | "database" | "security" | "observability" | "identity"
  | "tenant" | "providers" | "backup" | "disaster-recovery" | "compliance"
  | "clinical" | "releases" | "approvals" | "operations";

export interface CertificationArtifactInput {
  readonly category: CertificationArtifactCategory;
  readonly timestamp: string;
  readonly commitSha: string;
  readonly githubActionsRunId: string;
  readonly environment: string;
  readonly certificationVersion: string;
  readonly executionDurationMs: number;
  readonly status: "pass" | "fail" | "conditional";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signature?: string;
}

export interface CertificationArtifact extends CertificationArtifactInput {
  readonly evidenceHash: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createCertificationArtifact(
  input: CertificationArtifactInput,
): CertificationArtifact {
  if (!/^[a-f0-9]{40}$/i.test(input.commitSha)) {
    throw new Error("Certification artifact requires a full Git commit SHA");
  }
  if (input.executionDurationMs < 0) {
    throw new Error("Certification duration cannot be negative");
  }
  const evidenceHash = createHash("sha256").update(canonical(input)).digest("hex");
  return Object.freeze({ ...input, evidenceHash });
}

export class ImmutableCertificationRepository {
  private readonly artifacts = new Map<string, CertificationArtifact>();

  append(artifact: CertificationArtifact): void {
    if (this.artifacts.has(artifact.evidenceHash)) {
      throw new Error("Certification artifact is immutable and already exists");
    }
    this.artifacts.set(artifact.evidenceHash, artifact);
  }

  get(evidenceHash: string): CertificationArtifact | undefined {
    return this.artifacts.get(evidenceHash);
  }
}
