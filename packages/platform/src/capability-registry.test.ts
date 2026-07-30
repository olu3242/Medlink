import { describe, expect, it } from "vitest";
import { traceCapability, validateCapabilityRegistry } from "./capability-registry";

const capability = {
  id: "inventory-reservation",
  name: "Inventory reservation",
  ownerId: "inventory-team",
  maturity: "certified" as const,
  certificationStatus: "certified" as const,
  runtimeDependencies: ["runtime-transaction"],
  apiDependencies: ["inventory-v1"],
  dataDependencies: ["inventory_items"],
  operationalReadiness: "ready" as const,
  evidenceSha256: "c".repeat(64),
};

describe("capability registry", () => {
  it("validates certification traceability", () => {
    expect(validateCapabilityRegistry([capability])).toEqual([]);
    expect(traceCapability(capability.id, [capability]).dependencies).toHaveLength(3);
  });

  it("rejects duplicate capability identities", () => {
    expect(validateCapabilityRegistry([capability, capability])).toContain(
      `duplicate:${capability.id}`,
    );
  });
});
