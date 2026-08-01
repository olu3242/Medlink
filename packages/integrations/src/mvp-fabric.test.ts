import { describe, expect, it } from "vitest";
import {
  MvpMcpRegistry, assertIntegrationContext, distanceKilometres,
  loadMvpConfiguration, nearbyPharmacies, rc1Certification,
  rc2ExcludedIntegrations, validatePrescriptionUpload,
} from "./mvp-fabric";

const environment = {
  MEDLINK_API_URL: "https://api.medlink.test/",
  NEXT_PUBLIC_SUPABASE_URL: "https://database.medlink.test/",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

describe("MVP integration configuration", () => {
  it("loads safe defaults and normalizes origins", () => {
    expect(loadMvpConfiguration(environment)).toMatchObject({
      apiUrl: "https://api.medlink.test",
      supabaseUrl: "https://database.medlink.test",
      mapsProvider: "internal",
      aiProvider: "disabled",
      storageBucket: "prescriptions",
    });
  });
  it("requires provider secrets only when providers are enabled", () => {
    expect(() => loadMvpConfiguration({ ...environment, MAPS_PROVIDER: "google" })).toThrow("MAPS_API_KEY");
    expect(() => loadMvpConfiguration({ ...environment, AI_PROVIDER: "openai" })).toThrow("AI_API_KEY");
  });
});

describe("secure storage boundary", () => {
  it("accepts only bounded MVP prescription formats", () => {
    expect(() => validatePrescriptionUpload({ mediaType: "image/jpeg", size: 1024 })).not.toThrow();
    expect(() => validatePrescriptionUpload({ mediaType: "text/html", size: 1024 })).toThrow("media type");
    expect(() => validatePrescriptionUpload({ mediaType: "application/pdf", size: 11 * 1024 * 1024 })).toThrow("size");
  });
});

describe("tenant-scoped nearby pharmacy lookup", () => {
  it("filters tenant data and orders by deterministic distance", () => {
    const result = nearbyPharmacies({ latitude: 6.5244, longitude: 3.3792 }, [
      { pharmacyId: "far", tenantId: "tenant-a", lga: "Ikeja", latitude: 6.6018, longitude: 3.3515 },
      { pharmacyId: "other-tenant", tenantId: "tenant-b", lga: "Lagos Island", latitude: 6.5245, longitude: 3.3793 },
      { pharmacyId: "near", tenantId: "tenant-a", lga: "Lagos Island", latitude: 6.525, longitude: 3.38 },
    ], "tenant-a", 20);
    expect(result.map(item => item.pharmacyId)).toEqual(["near", "far"]);
    expect(distanceKilometres(result[0]!, result[0]!)).toBe(0);
  });
});

describe("governed integration surface", () => {
  it("rejects unapproved MCP capabilities and incomplete API context", () => {
    const registry = new MvpMcpRegistry(new Set(["medicine.read"]));
    registry.register({ name: "medicine_search", capability: "medicine.read", readOnly: true });
    expect(registry.list()).toHaveLength(1);
    expect(() => registry.register({ name: "notify", capability: "notification.send", readOnly: false })).toThrow("not approved");
    expect(() => assertIntegrationContext({ tenantId: "", subjectId: "user", correlationId: "c", idempotencyKey: "i", apiVersion: "v1" })).toThrow("tenantId");
  });
  it("certifies every RC1 integration and explicitly excludes RC2", () => {
    expect(rc1Certification).toHaveLength(19);
    expect(rc1Certification.every(item => item.evidence.length > 0)).toBe(true);
    expect(rc1Certification.some(item => item.status === "FAILED")).toBe(false);
    expect(rc2ExcludedIntegrations).toContain("payments");
  });
});
