import { describe, expect, it } from "vitest";
import {
  evaluateServiceHealth,
  validateServiceCatalog,
  type EnterpriseService,
  type ServiceCatalogEntry,
} from "./service-management";

const services: readonly EnterpriseService[] = [
  "patient", "pharmacy", "hospital", "clinical", "inventory", "messaging",
  "payment", "ai", "reporting", "integration",
];
const catalog: ServiceCatalogEntry[] = services.map((service) => ({
  service,
  tenantId: "tenant-1",
  ownerId: `owner-${service}`,
  slaId: `sla-${service}`,
  dependencies: [],
  availabilityTarget: 99.9,
  operationalStatus: "operational",
  maintenanceWindows: ["SUN 01:00Z"],
  changeHistory: ["created"],
  version: "1",
  runtimeVersion: "1",
  databaseVersion: "14",
  healthEvidenceSha256: "a".repeat(64),
  certification: "certified",
  releaseStatus: "active",
}));

describe("enterprise service management", () => {
  it("requires the complete owned service catalog", () => {
    expect(validateServiceCatalog(catalog)).toEqual([]);
    expect(validateServiceCatalog(catalog.slice(1))).toContain("service_missing:patient");
  });

  it("combines technical, dependency, certification, and customer health", () => {
    const result = evaluateServiceHealth(catalog[0]!, {
      availability: 99,
      latencyMs: 120,
      latencyTargetMs: 100,
      throughput: 10,
      minimumThroughput: 20,
      dependenciesHealthy: false,
      operationalRisk: 70,
      customerImpact: 80,
    });
    expect(result.health).toBe("degraded");
    expect(result.blockers).toContain("dependency_health");
  });
});
