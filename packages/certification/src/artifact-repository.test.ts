import { describe, expect, it } from "vitest";
import {
  createCertificationArtifact,
  ImmutableCertificationRepository,
} from "./artifact-repository";

describe("immutable certification artifacts", () => {
  const input = {
    category: "security" as const,
    timestamp: "2026-07-30T00:00:00Z",
    commitSha: "a".repeat(40),
    githubActionsRunId: "30573665676",
    environment: "production",
    certificationVersion: "1.0.0",
    executionDurationMs: 1200,
    status: "pass" as const,
    payload: { controls: 15 },
  };

  it("generates deterministic traceable SHA-256 evidence", () => {
    expect(createCertificationArtifact(input).evidenceHash).toBe(
      createCertificationArtifact(input).evidenceHash,
    );
    expect(createCertificationArtifact(input).evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate immutable artifacts", () => {
    const repository = new ImmutableCertificationRepository();
    const artifact = createCertificationArtifact(input);
    repository.append(artifact);
    expect(repository.get(artifact.evidenceHash)).toEqual(artifact);
    expect(() => repository.append(artifact)).toThrow("immutable");
  });
});
