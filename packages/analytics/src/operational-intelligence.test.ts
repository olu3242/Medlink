import { describe, expect, it } from "vitest";
import { buildOperationalScorecard } from "./operational-intelligence";

describe("operational intelligence", () => {
  it("produces evidence-backed advisory forecasts and regressions", () => {
    const result = buildOperationalScorecard([{
      tenantId: "tenant-1",
      signal: "provider_availability",
      current: 98,
      previous: 99,
      target: 99.9,
      higherIsBetter: true,
      evidenceSha256: "b".repeat(64),
    }]);
    expect(result.regressions).toEqual(["provider_availability"]);
    expect(result.forecasts.provider_availability).toBe(97);
    expect(result.advisoryOnly).toBe(true);
  });
});
