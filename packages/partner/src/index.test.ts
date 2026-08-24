import { describe, expect, it } from "vitest";
import { evaluateReadiness, partnerHandoff, partnerTypes } from "./index";

describe("Partner Engine domain", () => {
  it("keeps the required partner taxonomy closed and explicit", () => {
    expect(partnerTypes).toHaveLength(12);
    expect(partnerTypes).toContain("pharmacy");
    expect(partnerTypes).toContain("technology_api");
    expect(partnerTypes).toContain("government_regulator");
  });

  it("blocks activation until every independent readiness authority passes", () => {
    expect(evaluateReadiness({
      relationshipStatus: "approved", partnerType: "pharmacy",
      acceptedAgreement: true, allRequirementsSatisfied: true,
      integrationStatus: "certified", activePharmacyLocations: 0,
    })).toEqual({ ready: false, blockers: ["active_pharmacy_location_required"] });
  });

  it("hands pharmacy and manufacturer partners to existing authorities", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(partnerHandoff("pharmacy", id).authority).toBe("pharmacy_locations");
    expect(partnerHandoff("manufacturer", id).authority).toBe("merdp_manufacturer_source_links");
    expect(partnerHandoff("logistics", id).authority).toBe("partner-provider.v1");
  });
});
