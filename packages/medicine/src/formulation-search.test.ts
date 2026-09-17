import { describe, expect, it } from "vitest";
import { formulationFilters, formulationGroup, matchesFormulationFilters, matchesStockFilter, ratioFacets, unitFacets } from "./formulation-search";
import type { CanonicalMedicine } from "./intelligence";

const id = "00000000-0000-4000-8000-000000000001";
const medicine = (ingredientId: string, amount: number | null = 10, unit: string | null = "mg"): CanonicalMedicine => ({
  id, brandName: "Example", genericName: "Ingredient", therapeuticClassId: null,
  therapeuticClass: null, dosageForm: "tablet", route: "oral", strength: "10 mg", normalizedStrength: "10mg",
  packSize: null, manufacturer: null, controlled: false, status: "active", version: 1, aliases: [],
  ingredients: [{ ingredientId, preferredName: "Ingredient", amount, unit, primary: true }],
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
  it("rejects an inverted ingredient amount range", () => {
    expect(formulationFilters.safeParse({ medicineId: id, minAmount: 20, maxAmount: 10 }).success).toBe(false);
    expect(formulationFilters.safeParse({ medicineId: id, minAmount: 10, maxAmount: 20 }).success).toBe(true);
  });
  it("filters by ingredient unit", () => {
    const filters = formulationFilters.parse({ medicineId: id, unit: "mg" });
    expect(matchesFormulationFilters(medicine("a", 10, "mg"), "exact", filters)).toBe(true);
    expect(matchesFormulationFilters(medicine("a", 10, "ml"), "exact", filters)).toBe(false);
    expect(matchesFormulationFilters(medicine("a", null, null), "exact", filters)).toBe(false);
  });
  it("filters by normalized ratio/concentration", () => {
    const filters = formulationFilters.parse({ medicineId: id, ratio: "500:mass" });
    expect(matchesFormulationFilters(medicine("a", 500, "mg"), "exact", filters)).toBe(true);
    expect(matchesFormulationFilters(medicine("a", 0.5, "g"), "exact", filters)).toBe(true);
    expect(matchesFormulationFilters(medicine("a", 250, "mg"), "exact", filters)).toBe(false);
  });
  it("filters by an ingredient amount range", () => {
    const filters = formulationFilters.parse({ medicineId: id, minAmount: 100, maxAmount: 500 });
    expect(matchesFormulationFilters(medicine("a", 250, "mg"), "exact", filters)).toBe(true);
    expect(matchesFormulationFilters(medicine("a", 50, "mg"), "exact", filters)).toBe(false);
    expect(matchesFormulationFilters(medicine("a", 1000, "mg"), "exact", filters)).toBe(false);
    expect(matchesFormulationFilters(medicine("a", null, null), "exact", filters)).toBe(false);
  });
  it("derives sorted, de-duplicated unit and ratio facets from a result set", () => {
    expect(unitFacets([medicine("a", 10, "mg"), medicine("b", 5, "ml"), medicine("c", 20, "mg")])).toEqual(["mg", "ml"]);
    expect(ratioFacets([medicine("a", 500, "mg"), medicine("b", 0.5, "g")])).toEqual(["500:mass"]);
  });
});
