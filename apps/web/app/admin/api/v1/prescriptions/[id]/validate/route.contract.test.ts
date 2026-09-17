import { describe, expect, it } from "vitest";
import { validateSchema } from "./schema";

describe("POST /api/v1/prescriptions/{id}/validate contract", () => {
  const medicineId = "00000000-0000-4000-8000-000000000001";

  it("defaults the clinical-context arrays to empty rather than requiring them", () => {
    const result = validateSchema.safeParse({ medicineId });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.patientAllergies).toEqual([]);
      expect(result.data.activeIngredientIds).toEqual([]);
      expect(result.data.currentMedicineIds).toEqual([]);
    }
  });

  it("requires medicineId to be a UUID", () => {
    expect(validateSchema.safeParse({ medicineId: "not-a-uuid" }).success).toBe(false);
  });

  it("requires activeIngredientIds and currentMedicineIds entries to be UUIDs", () => {
    expect(
      validateSchema.safeParse({ medicineId, activeIngredientIds: ["not-a-uuid"] }).success,
    ).toBe(false);
    expect(
      validateSchema.safeParse({ medicineId, currentMedicineIds: ["not-a-uuid"] }).success,
    ).toBe(false);
  });

  it("accepts free-text patient allergies, since there is no ingredient-name resolution in this package", () => {
    expect(
      validateSchema.safeParse({ medicineId, patientAllergies: ["penicillin"] }).success,
    ).toBe(true);
  });
});
