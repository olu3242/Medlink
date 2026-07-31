import { describe, expect, it } from "vitest";
import { certificationProfiles } from "./certification-api";
import { CertificationEngine } from "./certification-engine";
import { certificationMarkdown } from "./certification-report";
import { certificationStatus, complianceScore } from "./compliance-score";
import { booleanPolicy } from "./policy";
import { PolicyRegistry } from "./policy-registry";

function policy(id: string, key: string, weight = 1) {
  return booleanPolicy({
    id, name: id, version: "1", category: "runtime", severity: "required",
    weight, evidenceKey: key, requiredEvidence: [key],
    failureMessage: `${id} failed`, remediation: `fix ${id}`,
  });
}

describe("enterprise certification", () => {
  it("registers providers and rejects duplicate ownership", () => {
    const registry = new PolicyRegistry();
    const provider = { name: "runtime", policies: [policy("runtime", "runtime")] };
    registry.register(provider);
    expect(registry.policies()).toHaveLength(1);
    expect(() => registry.register(provider)).toThrow("already registered");
  });

  it("evaluates weighted policies and profiles deterministically", () => {
    const registry = new PolicyRegistry();
    registry.register({
      name: "runtime",
      policies: [policy("pipeline", "pipeline", 3), policy("transaction", "transaction", 1)],
    });
    const engine = new CertificationEngine(
      registry,
      { platform: "1", runtime: "1" },
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    const report = engine.run(
      { values: { pipeline: true, transaction: false } },
      certificationProfiles.development,
    );
    expect(report).toMatchObject({
      score: 75,
      status: "development_ready",
      failedChecks: ["transaction"],
    });
    expect(engine.latestReport()).toEqual(report);
  });

  it("applies score bands consistently", () => {
    expect(certificationStatus(95)).toBe("enterprise_certified");
    expect(certificationStatus(85)).toBe("conditionally_certified");
    expect(certificationStatus(70)).toBe("development_ready");
    expect(certificationStatus(69)).toBe("not_certified");
    expect(complianceScore([])).toBe(0);
  });

  it("produces JSON-compatible and Markdown reports", () => {
    const registry = new PolicyRegistry();
    registry.register({ name: "runtime", policies: [policy("pipeline", "pipeline")] });
    const report = new CertificationEngine(registry, {
      platform: "1", runtime: "1",
    }).run({ values: { pipeline: true } }, certificationProfiles.enterprise);
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(certificationMarkdown(report)).toContain("| pipeline | runtime | PASS |");
  });

  it("fails closed when evidence is missing or evaluation throws", () => {
    const registry = new PolicyRegistry();
    registry.register({
      name: "failure",
      policies: [{
        ...policy("throws", "input"),
        evaluate: () => { throw new Error("sensitive detail"); },
      }],
    });
    const report = new CertificationEngine(registry, {
      platform: "1", runtime: "1",
    }).run({ values: { input: true } }, certificationProfiles.enterprise);
    expect(report.score).toBe(0);
    expect(JSON.stringify(report)).not.toContain("sensitive detail");
  });

  it("evaluates a large policy catalog within a local baseline", () => {
    const registry = new PolicyRegistry();
    registry.register({
      name: "catalog",
      policies: Array.from({ length: 1_000 }, (_, index) =>
        policy(`policy-${index}`, `key-${index}`)),
    });
    const values = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [`key-${index}`, true]),
    );
    const started = performance.now();
    new CertificationEngine(registry, { platform: "1", runtime: "1" })
      .run({ values }, certificationProfiles.enterprise);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
