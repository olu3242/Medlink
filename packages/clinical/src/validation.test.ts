import { describe, expect, it } from "vitest";
import {
  ClinicalValidationService,
  DuplicateTherapyRule,
  PatientAllergyRule,
  PolypharmacyRiskRule,
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

describe("PatientAllergyRule", () => {
  it("flags a critical, acknowledgement-required finding when an ingredient matches a declared allergy", () => {
    const result = new ClinicalValidationService([new PatientAllergyRule()]).validate({
      ...baseInput,
      patientAllergies: ["Ingredient-1"],
      activeIngredientIds: ["ingredient-1"],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "allergy",
      severity: "critical",
      requiresAcknowledgement: true,
    });
    expect(result.hasHardStop).toBe(true);
  });

  it("does not flag when no ingredient matches a declared allergy", () => {
    const result = new ClinicalValidationService([new PatientAllergyRule()]).validate({
      ...baseInput,
      patientAllergies: ["some-other-ingredient"],
    });
    expect(result.findings).toHaveLength(0);
  });

  it("does not flag when the patient has no declared allergies", () => {
    const result = new ClinicalValidationService([new PatientAllergyRule()]).validate(baseInput);
    expect(result.findings).toHaveLength(0);
  });
});

describe("PolypharmacyRiskRule", () => {
  it("flags at five or more concurrent medications", () => {
    const result = new ClinicalValidationService([new PolypharmacyRiskRule()]).validate({
      ...baseInput,
      currentMedicineIds: ["m1", "m2", "m3", "m4", "m5"],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: "polypharmacy_risk", severity: "warning" });
  });

  it("does not flag below the threshold", () => {
    const result = new ClinicalValidationService([new PolypharmacyRiskRule()]).validate({
      ...baseInput,
      currentMedicineIds: ["m1", "m2"],
    });
    expect(result.findings).toHaveLength(0);
  });
});
