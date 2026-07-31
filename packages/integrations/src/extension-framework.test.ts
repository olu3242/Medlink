import { describe, expect, it } from "vitest";
import { ExtensionRegistry } from "./extension-framework";

describe("extension framework", () => {
  it("registers certified, tenant-scoped provider extensions", () => {
    const registry = new ExtensionRegistry();
    registry.register({
      extension: {
        id: "payments-acme",
        point: "payment_provider",
        version: "1.0.0",
        contractVersion: "1.0.0",
        ownerId: "payments-team",
        tenantScoped: true,
        health: async () => true,
      },
      certificationEvidenceSha256: "d".repeat(64),
      enabledTenants: ["tenant-1"],
    });
    expect(registry.resolve("payment_provider", "tenant-1")).toHaveLength(1);
    expect(registry.resolve("payment_provider", "tenant-2")).toHaveLength(0);
  });
});
