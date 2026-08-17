import { describe, expect, it } from "vitest";
import type { EligiblePharmacyResult } from "./service";
import { classifyMedicationDiscovery } from "./medication-discovery";

function result(medicineId: string, price = false): EligiblePharmacyResult {
  return {
    pharmacy: {
      id: `location-${medicineId}`,
      tenantId: "tenant-a",
      name: `Pharmacy ${medicineId}`,
      location: { latitude: 6.5, longitude: 3.3 },
      active: true,
      open24Hours: false,
      updatedAt: "2026-08-17T00:00:00Z",
    },
    distanceKm: 2.5,
    inventory: {
      inventoryId: `inventory-${medicineId}`,
      pharmacyLocationId: `location-${medicineId}`,
      medicineId,
      medicineName: `Medicine ${medicineId}`,
      expiresOn: "2099-01-01",
      availableQuantity: 1,
      state: "in_stock",
      observedAt: "2026-08-17T00:00:00Z",
      unitPriceMinor: price ? 1250 : null,
      currencyCode: price ? "NGN" : null,
    },
  };
}

describe("classifyMedicationDiscovery", () => {
  it.each([
    [1, 0, "EXACT_BRAND_AVAILABLE"],
    [0, 1, "GENERIC_AVAILABLE"],
    [1, 1, "BOTH_AVAILABLE"],
    [0, 0, "NONE_AVAILABLE"],
  ] as const)("classifies exact=%s generic=%s", (exact, generic, outcome) => {
    const value = classifyMedicationDiscovery({
      requestedMedicineId: "requested",
      exact: exact ? [result("requested", true)] : [],
      generic: generic ? [result("related")] : [],
    });
    expect(value.outcome).toBe(outcome);
    expect(value.requestedMedicineId).toBe("requested");
  });

  it("never makes a generic-related option directly reservable", () => {
    const value = classifyMedicationDiscovery({
      requestedMedicineId: "requested",
      exact: [],
      generic: [result("related")],
    });
    expect(value.generic[0]).toMatchObject({
      relationship: "generic_related",
      reservationEligible: false,
      pharmacistReviewRequired: true,
      priceStatus: "PRICE_NOT_AVAILABLE",
    });
  });
});
