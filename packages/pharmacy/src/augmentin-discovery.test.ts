import { describe, expect, it } from "vitest";
import type { EligiblePharmacyResult } from "./service";
import { classifyMedicationDiscovery } from "./medication-discovery";

// SYNTHETIC / TEST-ONLY FIXTURE -- not real NAFDAC Greenbook data. See
// packages/medicine/src/augmentin-equivalence.test.ts for the corresponding
// ingredient-level equivalence fixture and the same synthetic/test-only
// disclosure. This file proves the discovery-outcome layer
// (classifyMedicationDiscovery, packages/pharmacy/src/medication-discovery.ts)
// against an Augmentin-shaped exact/generic/unavailable scenario. It does
// not touch or require a live database: discover_marketplace_inventory
// (the SQL RPC upstream of this classification, hardened in
// 202608240001_marketplace_registration_validity.sql) is what would
// exclude an expired-registration medicine from ever reaching this layer
// in production -- this fixture demonstrates the resulting NONE_AVAILABLE
// behavior when that upstream filtering has already happened, without
// re-testing the SQL predicate itself (see
// marketplace-registration-validity-migration.test.ts for that).

function eligiblePharmacyResult(
  medicineId: string,
  pharmacyId: string,
  overrides: Partial<EligiblePharmacyResult["inventory"]> = {},
): EligiblePharmacyResult {
  return {
    pharmacy: {
      id: pharmacyId,
      tenantId: "syn-aug-tenant",
      name: `Pharmacy ${pharmacyId}`,
      location: { latitude: 6.5, longitude: 3.3 },
      active: true,
      open24Hours: false,
      updatedAt: "2026-08-24T00:00:00Z",
    },
    distanceKm: 1.2,
    inventory: {
      inventoryId: `inventory-${medicineId}-${pharmacyId}`,
      pharmacyLocationId: pharmacyId,
      medicineId,
      medicineName: medicineId,
      expiresOn: "2099-01-01",
      availableQuantity: 5,
      state: "in_stock",
      observedAt: "2026-08-24T00:00:00Z",
      unitPriceMinor: 250000,
      currencyCode: "NGN",
      ...overrides,
    },
  };
}

// SYN-AUG-001 (the requested exact brand) and SYN-AUG-002 (the strict
// generic-equivalent brand), matching the ids used in the equivalence
// fixture for narrative consistency -- these are independent modules with
// no shared runtime dependency.
const EXACT_MEDICINE_ID = "syn-aug-001-requested";
const GENERIC_EQUIVALENT_MEDICINE_ID = "syn-aug-002-equivalent";

describe("synthetic Augmentin-style discovery outcomes (test-only fixture)", () => {
  it("EXACT_BRAND_AVAILABLE: only the requested brand is in stock anywhere", () => {
    const result = classifyMedicationDiscovery({
      requestedMedicineId: EXACT_MEDICINE_ID,
      exact: [eligiblePharmacyResult(EXACT_MEDICINE_ID, "pharmacy-a")],
      generic: [],
    });
    expect(result.outcome).toBe("EXACT_BRAND_AVAILABLE");
    expect(result.exact[0]?.reservationEligible).toBe(true);
    expect(result.exact[0]?.pharmacistReviewRequired).toBe(false);
  });

  it("GENERIC_AVAILABLE: only the strict generic-equivalent brand is in stock, and it is never directly reservable", () => {
    const result = classifyMedicationDiscovery({
      requestedMedicineId: EXACT_MEDICINE_ID,
      exact: [],
      generic: [eligiblePharmacyResult(GENERIC_EQUIVALENT_MEDICINE_ID, "pharmacy-b")],
    });
    expect(result.outcome).toBe("GENERIC_AVAILABLE");
    expect(result.generic[0]?.reservationEligible).toBe(false);
    expect(result.generic[0]?.pharmacistReviewRequired).toBe(true);
  });

  it("BOTH_AVAILABLE: exact and generic-equivalent brands both in stock at different pharmacies", () => {
    const result = classifyMedicationDiscovery({
      requestedMedicineId: EXACT_MEDICINE_ID,
      exact: [eligiblePharmacyResult(EXACT_MEDICINE_ID, "pharmacy-a")],
      generic: [eligiblePharmacyResult(GENERIC_EQUIVALENT_MEDICINE_ID, "pharmacy-b")],
    });
    expect(result.outcome).toBe("BOTH_AVAILABLE");
    expect(result.exact).toHaveLength(1);
    expect(result.generic).toHaveLength(1);
  });

  it("NONE_AVAILABLE: no exact or generic-equivalent inventory reaches this layer (e.g. every candidate was excluded upstream -- out of stock, or, per 202608240001, an expired/unregistered NAFDAC registration)", () => {
    const result = classifyMedicationDiscovery({
      requestedMedicineId: EXACT_MEDICINE_ID,
      exact: [],
      generic: [],
    });
    expect(result.outcome).toBe("NONE_AVAILABLE");
    expect(result.exact).toHaveLength(0);
    expect(result.generic).toHaveLength(0);
  });
});
