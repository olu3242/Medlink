import type { BrandMedicine } from "../../medicine/src/index";
import { describe, expect, it } from "vitest";
import { InvalidSearchQueryError } from "./errors";
import { IndexedMedicineSearchService } from "./service";

const now = new Date("2026-07-27T00:00:00.000Z");
const brand: BrandMedicine = {
  id: "00000000-0000-4000-8000-000000000001",
  brandName: "Panadol",
  normalizedName: "panadol",
  manufacturer: "Haleon",
  ingredients: [{
    genericId: "00000000-0000-4000-8000-000000000002",
    amount: 500,
    unit: "mg",
  }],
  dosageForm: "tablet",
  route: "oral",
  status: "active",
  createdAt: now,
  updatedAt: now,
};

describe("IndexedMedicineSearchService", () => {
  it("normalizes input and preserves ranked index order", async () => {
    const service = new IndexedMedicineSearchService(
      {
        search: async (input) => {
          expect(input.normalizedTerm).toBe("panadol");
          return {
            hits: [{
              id: brand.id,
              type: "brand",
              score: 0.98,
              matchedOn: "name",
            }],
          };
        },
      },
      {
        findBrandsByIds: async () => [brand],
        findGenericsByIds: async () => [],
      },
    );

    const result = await service.search({ term: "  PANADOL  " });
    expect(result.matches[0]).toMatchObject({
      entity: { type: "brand", value: { brandName: "Panadol" } },
      score: 0.98,
    });
  });

  it("rejects underspecified searches before querying the index", async () => {
    const service = new IndexedMedicineSearchService(
      { search: async () => ({ hits: [] }) },
      {
        findBrandsByIds: async () => [],
        findGenericsByIds: async () => [],
      },
    );
    await expect(service.search({ term: "a" })).rejects.toBeInstanceOf(
      InvalidSearchQueryError,
    );
  });
});
