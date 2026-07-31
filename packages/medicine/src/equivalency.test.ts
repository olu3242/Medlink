import { describe, expect, it, vi } from "vitest";
import type { BrandMedicine } from "./models";
import type { MedicineCatalogReader } from "./repository";
import {
  CatalogEquivalencyService,
  EquivalencyReviewRequiredError,
  PharmacistEquivalencyService,
} from "./index";

const now = new Date("2026-07-27T00:00:00.000Z");
const genericId = "00000000-0000-4000-8000-000000000001";
const source: BrandMedicine = {
  id: "00000000-0000-4000-8000-000000000002",
  brandName: "Source",
  normalizedName: "source",
  manufacturer: "MedLink",
  ingredients: [{ genericId, amount: 500, unit: "mg" }],
  dosageForm: "tablet",
  route: "oral",
  status: "active",
  createdAt: now,
  updatedAt: now,
};

function catalog(candidates: readonly BrandMedicine[]): MedicineCatalogReader {
  return {
    findBrandById: async () => null,
    findGenericById: async () => null,
    findBrandsByIngredientIds: async () => candidates,
  };
}

describe("CatalogEquivalencyService", () => {
  it("only marks exact pharmaceutical matches eligible and still requires review", async () => {
    const exact = { ...source, id: "00000000-0000-4000-8000-000000000003" };
    const wrongStrength = {
      ...source,
      id: "00000000-0000-4000-8000-000000000004",
      ingredients: [{ genericId, amount: 250, unit: "mg" as const }],
    };
    const service = new CatalogEquivalencyService(catalog([source, exact, wrongStrength]));

    const result = await service.propose({
      brandId: source.id,
      ingredients: source.ingredients,
      dosageForm: source.dosageForm,
      route: source.route,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      eligible: true,
      decision: "pharmacist_review_required",
      mayAutoSubstitute: false,
    });
    expect(result[1]).toMatchObject({
      eligible: false,
      reason: "strength_mismatch",
      mayAutoSubstitute: false,
    });
  });

  it("rejects use without a pharmacist decision", () => {
    const service = new CatalogEquivalencyService(catalog([]));
    expect(() => service.assertReviewed(null)).toThrow(
      EquivalencyReviewRequiredError,
    );
  });

  it("persists an attributed pharmacist decision", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const service = new PharmacistEquivalencyService(
      new CatalogEquivalencyService(catalog([])),
      { record },
    );
    await service.decide({
      candidateBrandId: source.id,
      approved: true,
      pharmacistId: "pharmacist-1",
      reviewedAt: new Date(),
      rationale: "Exact pharmaceutical match.",
    });
    expect(record).toHaveBeenCalledOnce();
  });
});
