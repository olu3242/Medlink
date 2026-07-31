import { describe, expect, it } from "vitest";
import {
  certifyRuntimeProfileEvidence,
  certifyRuntimeProfiles,
  runtimeProfileIds,
  type RuntimeProfileCapabilities,
} from "./runtime-profiles";

const complete: RuntimeProfileCapabilities = {
  authenticatedContext: true,
  tenantIsolation: true,
  authorization: true,
  structuredLogging: true,
  durableMetrics: true,
  distributedTracing: true,
  dependencyHealth: true,
  durableDiagnostics: true,
  immutableEvidence: true,
  humanEscalation: true,
  idempotency: true,
};

describe("runtime profile certification", () => {
  it("certifies all five required runtime profiles", () => {
    const reports = certifyRuntimeProfiles(complete);
    expect(reports.map((report) => report.profile)).toEqual([
      "api", "background", "ai", "administrative", "conversation",
    ]);
    expect(reports.every((report) => report.passed)).toBe(true);
  });

  it("fails AI and conversation closed without human escalation", () => {
    const reports = certifyRuntimeProfiles({
      ...complete,
      humanEscalation: false,
    });
    expect(reports.find((report) => report.profile === "ai")?.passed).toBe(false);
    expect(
      reports.find((report) => report.profile === "conversation")?.missing,
    ).toContain("humanEscalation");
  });

  it("certifies separate evidence for all five runtime profiles", () => {
    const results = certifyRuntimeProfileEvidence(runtimeProfileIds.map((profile) => ({
      profile,
      capabilities: complete,
      artifactSha256: "b".repeat(64),
      observedAt: new Date("2026-07-29"),
      environment: "staging",
    })));
    expect(results).toHaveLength(5);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it("fails a missing administrative profile without borrowing evidence", () => {
    const results = certifyRuntimeProfileEvidence(runtimeProfileIds
      .filter((profile) => profile !== "administrative")
      .map((profile) => ({
        profile,
        capabilities: complete,
        artifactSha256: "b".repeat(64),
        observedAt: new Date("2026-07-29"),
        environment: "staging",
      })));
    expect(results.find((result) => result.profile === "administrative"))
      .toMatchObject({ passed: false });
  });
});
