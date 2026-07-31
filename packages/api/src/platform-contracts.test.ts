import { describe, expect, it } from "vitest";
import { assessContractCompatibility } from "./platform-contracts";

const contract = {
  id: "partner-orders",
  audience: "external_partner" as const,
  version: "1.4.2",
  minimumCompatibleVersion: "1.2.0",
  schemaSha256: "e".repeat(64),
  deprecated: false,
};

describe("platform SDK contracts", () => {
  it("guarantees compatibility only inside the published major range", () => {
    expect(assessContractCompatibility(contract, "1.3.0").compatible).toBe(true);
    expect(assessContractCompatibility(contract, "2.0.0").compatible).toBe(false);
  });
});
