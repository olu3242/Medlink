import { describe, expect, it, vi } from "vitest";
import {
  InventoryManagement,
  changeInventoryStockSchema,
  createInventoryBatchSchema,
  type InventoryManagementRepository,
} from "./management";

function repository(): InventoryManagementRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    changeStock: vi.fn(),
    transactions: vi.fn().mockResolvedValue([]),
    availability: vi.fn().mockResolvedValue([]),
  };
}

describe("inventory management", () => {
  it("requires price and currency together", () => {
    expect(() => createInventoryBatchSchema.parse({
      pharmacyLocationId: "11111111-1111-4111-8111-111111111111",
      medicineId: "22222222-2222-4222-8222-222222222222",
      batchNumber: "LOT-001",
      expiresOn: "2027-12-31",
      quantity: 50,
      unit: "tablet",
      unitPriceMinor: 250,
    })).toThrow("Unit price and currency");
  });

  it("allows signed quantities only for adjustments", () => {
    expect(changeInventoryStockSchema.parse({
      expectedVersion: 1,
      kind: "adjustment",
      quantity: -2,
      reason: "Cycle count correction",
    }).quantity).toBe(-2);
    expect(() => changeInventoryStockSchema.parse({
      expectedVersion: 1,
      kind: "receive",
      quantity: -2,
      reason: "Invalid receipt",
    })).toThrow("receive quantity must be positive");
  });

  it("uses one repository boundary for FEFO availability", async () => {
    const value = repository();
    const service = new InventoryManagement(value);
    await service.availability({
      organizationId: "11111111-1111-4111-8111-111111111111",
      medicineId: "22222222-2222-4222-8222-222222222222",
      quantity: 3,
    });
    expect(value.availability).toHaveBeenCalledWith({
      organizationId: "11111111-1111-4111-8111-111111111111",
      medicineId: "22222222-2222-4222-8222-222222222222",
      quantity: 3,
    });
  });

  it("rejects zero stock movement and bounds service defaults", async () => {
    expect(() => changeInventoryStockSchema.parse({
      expectedVersion: 1,
      kind: "adjustment",
      quantity: 0,
      reason: "Cycle count",
    })).toThrow("cannot be zero");

    const value = repository();
    const service = new InventoryManagement(value);
    await service.list({
      organizationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(value.list).toHaveBeenCalledWith({
      organizationId: "11111111-1111-4111-8111-111111111111",
      includeInactive: false,
    });
  });

  it("fails closed for malformed inventory identifiers", async () => {
    const value = repository();
    const service = new InventoryManagement(value);
    await expect(service.find("not-a-tenant", "not-an-item"))
      .rejects.toThrow();
    expect(value.find).not.toHaveBeenCalled();
  });
});
