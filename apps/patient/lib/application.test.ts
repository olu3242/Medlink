import { describe, expect, it } from "vitest";
import {
  toMar,
  toMatch,
  type InventoryRow,
  type MarRow,
} from "./application";

describe("toMar", () => {
  it("maps the state column to status and derives medicineName from the joined medicine", () => {
    const row: MarRow = {
      id: "00000000-0000-4000-8000-000000000001",
      state: "matched",
      created_at: "2026-07-29T00:00:00.000Z",
      medicine: { brand_name: "Panadol", generic_name: "Paracetamol" },
    };
    expect(toMar(row)).toEqual({
      id: row.id,
      status: "matched",
      createdAt: row.created_at,
      medicineName: "Panadol",
    });
  });

  it("falls back to generic name, then a placeholder, when no medicine is joined", () => {
    const withGenericOnly: MarRow = {
      id: "1", state: "created", created_at: "t",
      medicine: { brand_name: "", generic_name: "Amoxicillin" },
    };
    expect(toMar(withGenericOnly).medicineName).toBe("Amoxicillin");

    const withNoMedicine: MarRow = { id: "1", state: "created", created_at: "t", medicine: null };
    expect(toMar(withNoMedicine).medicineName).toBe("Requested medicine");
  });

  it("never leaves status undefined, which the MAR detail page calls .toLowerCase() on unconditionally", () => {
    const row: MarRow = { id: "1", state: "reviewed", created_at: "t" };
    expect(typeof toMar(row).status).toBe("string");
  });
});

describe("toMatch", () => {
  it("maps inventory_batches columns to the Match contract using the real pharmacy locality, not a fabricated distance", () => {
    const row: InventoryRow = {
      id: "00000000-0000-4000-8000-000000000002",
      medicine_id: "00000000-0000-4000-8000-000000000003",
      pharmacy_location_id: "00000000-0000-4000-8000-000000000004",
      available_quantity: 12,
      expires_on: "2027-01-01",
      status: "available",
      medicine: { brand_name: "Panadol", generic_name: "Paracetamol" },
      pharmacy: { name: "Corner Pharmacy", locality: "Lekki" },
    };
    expect(toMatch(row)).toEqual({
      inventoryId: row.id,
      inventoryBatchId: row.id,
      medicineId: row.medicine_id,
      pharmacyLocationId: row.pharmacy_location_id,
      availableQuantity: 12,
      expiresOn: "2027-01-01",
      medicineName: "Panadol",
      pharmacyName: "Corner Pharmacy",
      pharmacyLocality: "Lekki",
      stockStatus: "available",
    });
  });

  it("falls back to placeholders rather than throwing when a join is missing", () => {
    const row: InventoryRow = {
      id: "1",
      medicine_id: "2",
      pharmacy_location_id: "3",
      available_quantity: 1,
      expires_on: "2027-01-01",
      status: "available",
    };
    const match = toMatch(row);
    expect(match.medicineName).toBe("Medicine");
    expect(match.pharmacyName).toBe("Pharmacy");
    expect(match.pharmacyLocality).toBeUndefined();
  });
});
