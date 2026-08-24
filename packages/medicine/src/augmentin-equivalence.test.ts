import { describe, expect, it } from "vitest";
import { CatalogEquivalencyService } from "./equivalency";
import type { BrandMedicine, IngredientStrength, MedicineReference } from "./models";
import type { MedicineCatalogReader } from "./repository";

// SYNTHETIC / TEST-ONLY FIXTURE. Not NAFDAC Greenbook data, not seeded into
// any migration or production table -- see the medication-intelligence
// certification report: zero real Augmentin-shaped data exists anywhere in
// this repository, and no live database is available in this environment
// to query real NAFDAC records. This models the combination-product
// equivalence shape (amoxicillin + clavulanic acid) purely to prove the
// existing CatalogEquivalencyService's strict-equivalence behavior against
// deliberate variants. A live run against real Greenbook data proving
// actual regulatory coverage is a separate, deferred certification --
// see the "LIVE AUGMENTIN CERTIFICATION" section of the implementation
// report. This fixture proves implementation BEHAVIOR, not regulatory DATA.

const AMOXICILLIN = "generic-amoxicillin";
const CLAVULANIC_ACID = "generic-clavulanic-acid";
const PARACETAMOL = "generic-paracetamol";

function ingredient(
  genericId: string,
  amount: number,
  unit: IngredientStrength["unit"] = "mg",
): IngredientStrength {
  return { genericId, amount, unit };
}

function brand(overrides: Partial<BrandMedicine> & { id: string; brandName: string }): BrandMedicine {
  return {
    normalizedName: overrides.brandName.toLowerCase(),
    manufacturer: "Synthetic Test Manufacturer",
    ingredients: [],
    dosageForm: "tablet",
    route: "oral",
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// SYN-AUG-001: the requested brand -- combination product, 500mg/125mg,
// tablet, oral. Synthetic analogue of Augmentin 625.
const requestedBrand = brand({
  id: "syn-aug-001-requested",
  brandName: "SYN-Augmentin 625 (test-only)",
  ingredients: [ingredient(AMOXICILLIN, 500), ingredient(CLAVULANIC_ACID, 125)],
  dosageForm: "tablet",
  route: "oral",
});
const reference: MedicineReference = {
  brandId: requestedBrand.id,
  ingredients: requestedBrand.ingredients,
  dosageForm: requestedBrand.dosageForm,
  route: requestedBrand.route,
};

// SYN-AUG-002: same ingredients, same strength, same dosage form and route
// -> the one candidate that must be STRICT_EQUIVALENT-eligible.
const sameEverythingBrand = brand({
  id: "syn-aug-002-equivalent",
  brandName: "SYN-Curam 625 (test-only)",
  ingredients: [ingredient(AMOXICILLIN, 500), ingredient(CLAVULANIC_ACID, 125)],
  dosageForm: "tablet",
  route: "oral",
});

// SYN-AUG-003: same ingredients, DIFFERENT strength (875mg amoxicillin
// instead of 500mg) -> must be rejected as strength_mismatch, not eligible.
const differentStrengthBrand = brand({
  id: "syn-aug-003-different-strength",
  brandName: "SYN-Augmentin 1g (test-only)",
  ingredients: [ingredient(AMOXICILLIN, 875), ingredient(CLAVULANIC_ACID, 125)],
  dosageForm: "tablet",
  route: "oral",
});

// SYN-AUG-004: same ingredients and strength, DIFFERENT dosage form
// (suspension instead of tablet) -> must be rejected as dosage_form_mismatch.
const differentFormBrand = brand({
  id: "syn-aug-004-different-form",
  brandName: "SYN-Augmentin Suspension (test-only)",
  ingredients: [ingredient(AMOXICILLIN, 500), ingredient(CLAVULANIC_ACID, 125)],
  dosageForm: "suspension",
  route: "oral",
});

// SYN-AUG-005: INCOMPLETE ingredient set -- amoxicillin only, missing the
// clavulanic-acid component -> must be rejected as ingredient_mismatch, not
// silently accepted because one ingredient name overlaps.
const incompleteIngredientBrand = brand({
  id: "syn-aug-005-incomplete",
  brandName: "SYN-Amoxil 500 (test-only)",
  ingredients: [ingredient(AMOXICILLIN, 500)],
  dosageForm: "tablet",
  route: "oral",
});

// SYN-AUG-006: unrelated medicine sharing neither ingredient -- a control
// case that must never be surfaced as a candidate at all (findBrandsByIngredientIds
// is queried by the reference's own ingredient IDs, so this never even
// enters the candidate list -- proven by test 2 below).
const unrelatedBrand = brand({
  id: "syn-aug-006-unrelated",
  brandName: "SYN-Panadol (test-only)",
  ingredients: [ingredient(PARACETAMOL, 500)],
  dosageForm: "tablet",
  route: "oral",
});

function catalogReader(brands: readonly BrandMedicine[]): MedicineCatalogReader {
  return {
    findBrandById: async (id) => brands.find((candidate) => candidate.id === id) ?? null,
    findGenericById: async () => null,
    findBrandsByIngredientIds: async (genericIds) => brands.filter((candidate) =>
      candidate.ingredients.some((ing) => genericIds.includes(ing.genericId))),
  };
}

describe("synthetic Augmentin-style combination-product equivalence (test-only fixture)", () => {
  it("brand -> active ingredients -> eligible equivalent registered products: same ingredients/strength/form/route is the only eligible candidate", async () => {
    const service = new CatalogEquivalencyService(catalogReader([
      requestedBrand, sameEverythingBrand, differentStrengthBrand,
      differentFormBrand, incompleteIngredientBrand, unrelatedBrand,
    ]));
    const candidates = await service.propose(reference);

    const eligible = candidates.filter((candidate) => candidate.eligible);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.medicine.id).toBe(sameEverythingBrand.id);
    expect(eligible[0]?.reason).toBe("same_active_ingredients_strength_form_and_route");
    // Pharmacist governance: eligibility never implies auto-substitution.
    expect(eligible[0]?.mayAutoSubstitute).toBe(false);
    expect(eligible[0]?.decision).toBe("pharmacist_review_required");
  });

  it("generic/ingredient combination -> matching registered brands: the query is driven by the reference's own ingredient set", async () => {
    const reader = catalogReader([
      requestedBrand, sameEverythingBrand, differentStrengthBrand,
      differentFormBrand, incompleteIngredientBrand, unrelatedBrand,
    ]);
    const brands = await reader.findBrandsByIngredientIds([AMOXICILLIN, CLAVULANIC_ACID]);
    const ids = brands.map((candidate) => candidate.id).sort();
    // The unrelated (paracetamol-only) brand must never appear -- ingredient
    // overlap is required, not name similarity. The requested brand itself
    // IS included at this raw query layer (it shares its own ingredients,
    // naturally); CatalogEquivalencyService.propose() is what excludes it
    // from the candidate list, proven separately above.
    expect(ids).not.toContain(unrelatedBrand.id);
    expect(ids).toEqual([
      differentFormBrand.id, differentStrengthBrand.id,
      incompleteIngredientBrand.id, requestedBrand.id, sameEverythingBrand.id,
    ].sort());
  });

  it("rejects a candidate with the same ingredients but different strength", async () => {
    const service = new CatalogEquivalencyService(catalogReader([requestedBrand, differentStrengthBrand]));
    const [candidate] = await service.propose(reference);
    expect(candidate?.medicine.id).toBe(differentStrengthBrand.id);
    expect(candidate?.eligible).toBe(false);
    expect(candidate?.reason).toBe("strength_mismatch");
  });

  it("rejects a candidate with the same ingredients/strength but different dosage form", async () => {
    const service = new CatalogEquivalencyService(catalogReader([requestedBrand, differentFormBrand]));
    const [candidate] = await service.propose(reference);
    expect(candidate?.medicine.id).toBe(differentFormBrand.id);
    expect(candidate?.eligible).toBe(false);
    expect(candidate?.reason).toBe("dosage_form_mismatch");
  });

  it("rejects a candidate with an incomplete active-ingredient set (one overlapping ingredient is not enough)", async () => {
    const service = new CatalogEquivalencyService(catalogReader([requestedBrand, incompleteIngredientBrand]));
    const [candidate] = await service.propose(reference);
    expect(candidate?.medicine.id).toBe(incompleteIngredientBrand.id);
    expect(candidate?.eligible).toBe(false);
    expect(candidate?.reason).toBe("ingredient_mismatch");
  });

  it("never proposes the reference brand itself as its own equivalent candidate", async () => {
    const service = new CatalogEquivalencyService(catalogReader([requestedBrand, sameEverythingBrand]));
    const candidates = await service.propose(reference);
    expect(candidates.some((candidate) => candidate.medicine.id === requestedBrand.id)).toBe(false);
  });
});
