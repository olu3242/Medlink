import { describe, expect, it } from "vitest";
import { EvidenceCollector } from "./evidence-collector";
import { EvidenceRepository } from "./evidence-repository";
import { MemoryEvidenceStore } from "./evidence-store";
import type { EvidenceInput } from "./evidence-types";
import { RetentionPolicyRegistry } from "./retention-policy";

const input: EvidenceInput = {
  type: "certification.report",
  category: "certification",
  sourceComponent: "certification-engine",
  correlationId: "correlation",
  traceId: "trace",
  requestId: "request",
  runtimeVersion: "1",
  platformVersion: "1",
  certificationProfile: "enterprise",
  timestamp: "2026-01-01T00:00:00.000Z",
  metadata: { score: 100, passed: true },
  retentionClass: "compliance",
};

describe("runtime evidence repository", () => {
  it("creates immutable, hash-verified evidence", async () => {
    const repository = new EvidenceRepository(new MemoryEvidenceStore(), () => "one");
    const record = await repository.create(input);
    expect(record.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repository.verify(record)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.metadata)).toBe(true);
    expect(repository.verify({ ...record, metadata: { score: 50 } })).toBe(false);
  });

  it("versions evidence without overwriting history", async () => {
    let next = 0;
    const repository = new EvidenceRepository(
      new MemoryEvidenceStore(),
      () => `id-${++next}`,
    );
    const first = await repository.create(input);
    const second = await repository.create({
      ...input,
      timestamp: "2026-01-02T00:00:00.000Z",
      parentVersionId: first.id,
    });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await repository.get(first.id))?.version).toBe(1);
  });

  it("applies configurable retention without deleting evidence", () => {
    const policies = new RetentionPolicyRegistry();
    policies.register({ retentionClass: "temporary", durationDays: 7, archive: false });
    policies.register({ retentionClass: "permanent", archive: true });
    expect(policies.expiresAt(input.timestamp, "temporary"))
      .toBe("2026-01-08T00:00:00.000Z");
    expect(policies.expiresAt(input.timestamp, "permanent")).toBeUndefined();
  });

  it("collects evidence through registered providers", async () => {
    const repository = new EvidenceRepository(new MemoryEvidenceStore(), () => "one");
    const collector = new EvidenceCollector(repository);
    collector.register({ name: "certification", collect: async () => [input] });
    expect(await collector.collect()).toHaveLength(1);
    expect(() => collector.register({
      name: "certification", collect: async () => [],
    })).toThrow("already registered");
  });

  it("filters evidence by category, correlation, profile, and time", async () => {
    const repository = new EvidenceRepository(new MemoryEvidenceStore(), () => "one");
    await repository.create(input);
    expect(await repository.search({
      category: "certification",
      correlationId: "correlation",
      certificationProfile: "enterprise",
      from: "2025-12-31T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    })).toHaveLength(1);
    expect(await repository.search({ category: "security" })).toHaveLength(0);
  });

  it("stores and retrieves a practical evidence volume within a local baseline", async () => {
    let next = 0;
    const repository = new EvidenceRepository(
      new MemoryEvidenceStore(),
      () => `id-${++next}`,
    );
    const started = performance.now();
    await Promise.all(Array.from({ length: 500 }, () => repository.create(input)));
    expect((await repository.search({ category: "certification" }))).toHaveLength(500);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
