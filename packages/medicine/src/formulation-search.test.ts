import { describe, expect, it } from "vitest";
import { formulationFilters, formulationGroup, matchesStockFilter } from "./formulation-search";
import type { CanonicalMedicine } from "./intelligence";

const id = "00000000-0000-4000-8000-000000000001";
const medicine = (ingredientId: string): CanonicalMedicine => ({
  id, brandName: "Example", genericName: "Ingredient", therapeuticClassId: null,
  therapeuticClass: null, dosageForm: "tablet", route: "oral", strength: "10 mg", normalizedStrength: "10mg",
  packSize: null, manufacturer: null, controlled: false, status: "active", version: 1, aliases: [],
  ingredients: [{ ingredientId, preferredName: "Ingredient", amount: 10, unit: "mg", primary: true }],
  registrations: [], createdAt: "", updatedAt: "",
});
describe("structured formulation search", () => {
  it("accepts database stock states without admitting unavailable inventory", () => {
    expect(matchesStockFilter("in_stock", "in_stock")).toBe(true);
    expect(matchesStockFilter("low_stock", "in_stock")).toBe(true);
    expect(matchesStockFilter("low_stock", "low_stock")).toBe(true);
    expect(matchesStockFilter("in_stock", "low_stock")).toBe(false);
    expect(matchesStockFilter("expired", "in_stock")).toBe(false);
  });
  it("requires an explicit reviewed relationship for different ingredients", () => {
    expect(formulationGroup(medicine("a"), medicine("b"), [])).toBeNull();
    expect(formulationGroup(medicine("a"), medicine("b"), [id])).toBe("therapeutic");
  });
  it("keeps unverified same-ingredient formulations review-only", () => {
    expect(formulationGroup(medicine("a"), medicine("a"), [])).toBe("related");
  });
  it("rejects inverted prices and incomplete location consent", () => {
    expect(formulationFilters.safeParse({ medicineId: id, minPrice: 20, maxPrice: 10 }).success).toBe(false);
    expect(formulationFilters.safeParse({ medicineId: id, latitude: 0, longitude: 0 }).success).toBe(false);
    expect(formulationFilters.safeParse({ medicineId: id, latitude: 0, longitude: 0, locationConsent: "true" }).success).toBe(true);
  });
});
