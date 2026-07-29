import { describe, expect, it } from "vitest";
import { toBrandMedicine } from "./medicine-repository";

const ingredientId = "00000000-0000-4000-8000-000000000002";
const baseRow = {
  id: "00000000-0000-4000-8000-000000000001",
  brand_name: "Panadol",
  manufacturer_name: "GSK",
  dosage_form: "tablet",
  route: "oral",
  status: "active",
  created_at: "2026-07-29T00:00:00.000Z",
  updated_at: "2026-07-29T00:00:00.000Z",
  medicine_ingredients: [
    { active_ingredient_id: ingredientId, amount: "500", unit: "mg" },
  ],
};

describe("toBrandMedicine", () => {
  it("maps a valid row to the packages/medicine BrandMedicine shape", () => {
    const medicine = toBrandMedicine(baseRow);
    expect(medicine).not.toBeNull();
    expect(medicine).toMatchObject({
      id: baseRow.id,
      brandName: "Panadol",
      manufacturer: "GSK",
      dosageForm: "tablet",
      route: "oral",
      status: "active",
      ingredients: [{ genericId: ingredientId, amount: 500, unit: "mg" }],
    });
  });

  it("returns null rather than throwing for a row outside packages/medicine's closed vocabularies", () => {
    const medicine = toBrandMedicine({ ...baseRow, dosage_form: "not-a-real-dosage-form" });
    expect(medicine).toBeNull();
  });

  it("returns null for a row with no ingredients, since brandMedicineSchema requires at least one", () => {
    const medicine = toBrandMedicine({ ...baseRow, medicine_ingredients: [] });
    expect(medicine).toBeNull();
  });
});
