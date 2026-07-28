import { describe, expect, it } from "vitest";
import {
  ClinicalValidationService,
  DuplicateTherapyRule,
  type ClinicalRule,
} from "./validation";

const baseInput = {
  medicineId: "medicine-1",
  patientAllergies: [],
  activeIngredientIds: ["ingredient-1"],
  currentMedicineIds: [],
};

describe("ClinicalValidationService", () => {
  it("requires pharmacist review even with no findings", () => {
    const result = new ClinicalValidationService([]).validate(baseInput);
    expect(result.requiresPharmacistReview).toBe(true);
    expect(result.hasHardStop).toBe(false);
  });

  it("identifies duplicate therapy", () => {
    const result = new ClinicalValidationService([
      new DuplicateTherapyRule(),
    ]).validate({ ...baseInput, currentMedicineIds: ["medicine-1"] });
    expect(result.findings[0]?.code).toBe("duplicate_therapy");
  });

  it("creates a hard stop for critical acknowledged risks", () => {
    const criticalRule: ClinicalRule = {
      id: "allergy",
      evaluate: () => [{
        code: "allergy_conflict",
        severity: "critical",
        summary: "Potential allergy conflict.",
        source: "patient.allergies",
        requiresAcknowledgement: true,
      }],
    };
    expect(
      new ClinicalValidationService([criticalRule]).validate(baseInput).hasHardStop,
    ).toBe(true);
  });
});
