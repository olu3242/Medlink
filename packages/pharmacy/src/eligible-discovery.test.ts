import { describe, expect, it } from "vitest";
import { findEligiblePharmacies } from "./service";

const location = (id: string, longitude: number) => ({
  id, tenantId: "tenant-a", name: id,
  location: { latitude: 6.5244, longitude }, active: true,
  open24Hours: false, updatedAt: "2026-08-17T00:00:00Z",
});
const inventory = (id: string, pharmacyLocationId: string, expiresOn: string) => ({
  inventoryId: id, pharmacyLocationId, medicineId: "medicine-a", expiresOn,
  availableQuantity: 1, state: "in_stock", observedAt: "2026-08-17T00:00:00Z",
});

describe("findEligiblePharmacies", () => {
  it("requires consent and filters tenant, radius, expiry, sellability, and participation", () => {
    expect(() => findEligiblePharmacies({
      tenantId: "tenant-a", medicineId: "medicine-a",
      origin: { latitude: 6.5244, longitude: 3.3792 }, radiusKm: 20,
      locationConsent: false, locations: [], inventory: [],
    })).toThrow("Location consent is required");

    const results = findEligiblePharmacies({
      tenantId: "tenant-a", medicineId: "medicine-a",
      origin: { latitude: 6.5244, longitude: 3.3792 }, radiusKm: 20,
      locationConsent: true,
      locations: [location("near", 3.38), location("far", 5), {
        ...location("other-tenant", 3.38), tenantId: "tenant-b",
      }, { ...location("inactive", 3.38), active: false }],
      inventory: [inventory("eligible", "near", "2099-01-01"),
        inventory("expired", "near", "2020-01-01"),
        { ...inventory("empty", "near", "2099-01-01"), availableQuantity: 0 }],
    });
    expect(results.map(({ pharmacy }) => pharmacy.id)).toEqual(["near"]);
    expect(results[0]?.inventory.inventoryId).toBe("eligible");
  });

  it("selects FEFO inventory deterministically per pharmacy", () => {
    const results = findEligiblePharmacies({
      tenantId: "tenant-a", medicineId: "medicine-a",
      origin: { latitude: 6.5244, longitude: 3.3792 }, radiusKm: 20,
      locationConsent: true, locations: [location("near", 3.38)],
      inventory: [inventory("later", "near", "2099-02-01"),
        inventory("earlier", "near", "2099-01-01")],
    });
    expect(results[0]?.inventory.inventoryId).toBe("earlier");
  });
});
