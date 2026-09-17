import { describe, expect, it } from "vitest";
import { classifyCandidate, criteriaForPreset, defaultMatchCriteria, getFacets, type CanonicalMedicine } from "./intelligence";

const id = "00000000-0000-4000-8000-000000000001";
const ingredient = "00000000-0000-4000-8000-000000000002";
const otherIngredient = "00000000-0000-4000-8000-000000000003";

function medicine(overrides: Partial<CanonicalMedicine> = {}): CanonicalMedicine {
  return {
    id, brandName: "Augmentin", genericName: "Amoxicillin + Clavulanic Acid", therapeuticClassId: null,
    therapeuticClass: null, dosageForm: "tablet", route: "oral", strength: "500 mg + 125 mg",
    normalizedStrength: "500mg+125mg", packSize: null, manufacturer: "GSK", controlled: false,
    status: "active", version: 1, aliases: [], ingredients: [{ ingredientId: ingredient, preferredName: "Amoxicillin", amount: 500, unit: "mg", primary: true }],
    registrations: [{ id, countryCode: "NG", authorityCode: "NAFDAC", registrationNumber: "A", validFrom: "2020-01-01", validUntil: "2099-01-01" }],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}

describe("medicine intelligence criteria", () => {
  it("provides the required defaults and preset overrides", () => {
    expect(defaultMatchCriteria).toMatchObject({ activeIngredient: true, strength: true, dosageForm: true, route: true, activeRegistration: true });
    expect(criteriaForPreset("SAME_INGREDIENT")).toMatchObject({ activeIngredient: true, strength: false, dosageForm: false, route: false });
    expect(criteriaForPreset("BROAD_CATALOG").activeRegistration).toBe(false);
    expect(criteriaForPreset("AVAILABILITY").inStockOnly).toBe(true);
  });

  it("keeps unchecked dimensions broad without calling broader matches exact", () => {
    const reference = medicine();
    const candidate = medicine({ id: "00000000-0000-4000-8000-000000000004", normalizedStrength: "875mg+125mg", strength: "875 mg + 125 mg" });
    const result = classifyCandidate(reference, candidate, { ...defaultMatchCriteria, strength: false }, "2026-09-08");
    expect(result?.tier).toBe("SAME_INGREDIENT_DIFFERENT_STRENGTH");
  });

  it("rejects an ingredient mismatch when ingredient matching is selected", () => {
    const result = classifyCandidate(medicine(), medicine({ ingredients: [{ ingredientId: otherIngredient, preferredName: "Other", amount: 500, unit: "mg", primary: true }] }), defaultMatchCriteria, "2026-09-08");
    expect(result).toBeNull();
  });

  it("derives only present facet values", () => {
    const candidate = classifyCandidate(medicine(), medicine({ id: "00000000-0000-4000-8000-000000000004" }), defaultMatchCriteria, "2026-09-08");
    expect(getFacets(candidate ? [candidate] : [], "2026-09-08").dosageForms).toEqual([{ value: "tablet", count: 1 }]);
    expect(getFacets([]).dosageForms).toEqual([]);
  });

  it("never promotes missing ingredient data to an exact match", () => {
    for (const ingredients of [[], [{ ingredientId: ingredient, preferredName: "Amoxicillin", amount: null, unit: null, primary: true }]]) {
      const value = medicine({ ingredients });
      expect(classifyCandidate(value, value, defaultMatchCriteria)?.tier).not.toBe("EXACT_EQUIVALENT");
    }
  });

  it("checks per-ingredient amounts even when display strengths agree", () => {
    const reference = medicine();
    const candidate = medicine({ ingredients: [{ ...reference.ingredients[0]!, amount: 875 }] });
    expect(classifyCandidate(reference, candidate, defaultMatchCriteria)).toBeNull();
    expect(classifyCandidate(reference, candidate, criteriaForPreset("BROAD_CATALOG"))?.tier).toBe("SAME_INGREDIENT_DIFFERENT_STRENGTH");
  });

  it("rejects changed combination ratios and duplicate ingredient identifiers", () => {
    const first = medicine().ingredients[0]!;
    const second = { ...first, ingredientId: otherIngredient, amount: 125 };
    const reference = medicine({ ingredients: [first, second] });
    expect(classifyCandidate(reference, medicine({ ingredients: [{ ...first, amount: 125 }, { ...second, amount: 500 }] }), defaultMatchCriteria)).toBeNull();
    const duplicate = medicine({ ingredients: [first, first] });
    expect(classifyCandidate(duplicate, duplicate, defaultMatchCriteria)).toBeNull();
  });

  it("does not call retired references or non-Nigerian registrations exact", () => {
    expect(classifyCandidate(medicine({ status: "retired" }), medicine(), defaultMatchCriteria)?.tier).not.toBe("EXACT_EQUIVALENT");
    const value = medicine();
    expect(classifyCandidate(value, medicine({ registrations: [{ ...value.registrations[0]!, countryCode: "US" }] }), defaultMatchCriteria)).toBeNull();
  });
});
