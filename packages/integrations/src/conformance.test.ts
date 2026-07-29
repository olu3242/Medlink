import { describe, expect, it } from "vitest";
import {
  ConformanceRegistry,
  type Rc1Integration,
  verifyConformanceArtifacts,
} from "./conformance";

describe("external conformance registry", () => {
  it("rejects internal-only and incomplete evidence", () => {
    const approved: Rc1Integration[] = ["ocr", "whatsapp", "payment", "fhir", "hl7"];
    const result = new ConformanceRegistry(approved).certify([{
      integration: "ocr",
      profile: "provider-sandbox-v1",
      environment: "local",
      artifactSha256: "abc",
      executedAt: new Date(),
      passed: true,
      external: false,
    }]);
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(approved);
  });

  it("passes only complete external evidence", () => {
    const approved: Rc1Integration[] = ["whatsapp", "payment"];
    const result = new ConformanceRegistry(approved).certify(approved.map((integration) => ({
      integration,
      profile: "sandbox-v1",
      environment: "provider-sandbox",
      artifactSha256: `sha-${integration}`,
      executedAt: new Date(),
      passed: true,
      external: true,
    })));
    expect(result).toEqual({ passed: true, missing: [], failed: [] });
  });

  it("verifies external artifact content against its SHA-256 digest", async () => {
    const content = new TextEncoder().encode("provider conformance result");
    const evidence = await verifyConformanceArtifacts([{
      integration: "fhir",
      profile: "r4-patient-read",
      environment: "partner-sandbox",
      artifactSha256: "e7baa3b65fd7c150cacaa91ee50833177145896a1bf8a7f3db48e312aadc688a",
      executedAt: new Date("2026-07-29"),
      expiresAt: new Date("2027-07-29"),
      passed: true,
      external: true,
      content,
    }], new Date("2026-07-30"));
    expect(evidence[0]?.passed).toBe(true);
  });
});
