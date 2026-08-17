import { describe, expect, it } from "vitest";
import { RuntimeError } from "@medlink/runtime";
import { findEligiblePharmacies } from "./service";

const location = (id: string, longitude: number) => ({
  id, tenantId: "tenant-a", name: id,
  location: { latitude: 6.5244, longitude }, active: true,
  open24Hours: false, updatedAt: "2026-08-17T00:00:00Z",
});
const inventory = (id: string, pharmacyLocationId: string, expiresOn: string) => ({
  inventoryId: id, pharmacyLocationId, medicineId: "medicine-a", expiresOn,
  medicineName: "Medicine A",
  availableQuantity: 1, state: "in_stock", observedAt: "2026-08-17T00:00:00Z",
  unitPriceMinor: null, currencyCode: null,
});

describe("findEligiblePharmacies", () => {
  it("rejects missing consent and an out-of-bounds radius as client-actionable 400s, not opaque server errors", () => {
    // A caller-fixable mistake (no consent granted, or a radius outside
    // [1, 200]) must reach the API boundary as a RuntimeError with its own
    // status/code -- toRuntimeError() (packages/runtime) only special-cases
    // RuntimeError and z.ZodError, collapsing every other thrown value to a
    // generic 500 "internal_error" regardless of any status/code property it
    // happens to carry. A plain Error here previously meant a patient who
    // simply hadn't granted location access saw the same "retry later,
    // contact support" response as a real infrastructure failure.
    let consentError: unknown;
    try {
      findEligiblePharmacies({
        tenantId: "tenant-a", medicineId: "medicine-a",
        origin: { latitude: 6.5244, longitude: 3.3792 }, radiusKm: 20,
        locationConsent: false, locations: [], inventory: [],
      });
    } catch (error) {
      consentError = error;
    }
    expect(consentError).toBeInstanceOf(RuntimeError);
    expect((consentError as RuntimeError).status).toBe(400);
    expect((consentError as RuntimeError).code).toBe("location_consent_required");

    let radiusError: unknown;
    try {
      findEligiblePharmacies({
        tenantId: "tenant-a", medicineId: "medicine-a",
        origin: { latitude: 6.5244, longitude: 3.3792 }, radiusKm: 201,
        locationConsent: true, locations: [], inventory: [],
      });
    } catch (error) {
      radiusError = error;
    }
    expect(radiusError).toBeInstanceOf(RuntimeError);
    expect((radiusError as RuntimeError).status).toBe(400);
    expect((radiusError as RuntimeError).code).toBe("invalid_discovery_radius");

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
