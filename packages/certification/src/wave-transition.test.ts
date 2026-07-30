import { describe, expect, it } from "vitest";
import { evaluateWaveTransition } from "./wave-transition";

describe("wave transition", () => {
  it("can certify the framework while keeping Wave 2.5 blocked", () => {
    const framework = [
      "wave_registry", "capability_registry", "extension_contracts",
      "sdk_compatibility", "roadmap_governance",
    ] as const;
    const result = evaluateWaveTransition("wave-2.5", framework.map((gate) => ({
      gate,
      passed: true,
      evidenceSha256: "a".repeat(64),
    })));
    expect(result.frameworkReady).toBe(true);
    expect(result.admission).toBe("blocked");
    expect(result.businessCapabilitiesImplemented).toBe(false);
  });
});
