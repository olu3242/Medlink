import { describe, expect, it } from "vitest";
import { ClinicalValidationService, DuplicateTherapyRule } from "@medlink/clinical";
import type { WorkflowInstance } from "./service";
import { createClinicalValidationStep } from "./clinical-review";

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "clinical_review",
    status: "running",
    completedSteps: [],
    context,
  };
}

describe("createClinicalValidationStep", () => {
  it("runs validation against the input in the workflow context and returns the result", async () => {
    const service = new ClinicalValidationService([new DuplicateTherapyRule()]);
    const step = createClinicalValidationStep(service);

    const patch = await step.execute(
      baseInstance({
        clinicalValidationInput: {
          medicineId: "med-1",
          patientAllergies: [],
          activeIngredientIds: [],
          currentMedicineIds: ["med-1"],
        },
      }),
    );

    expect(patch).toMatchObject({
      clinicalValidationResult: {
        requiresPharmacistReview: true,
        findings: [{ code: "duplicate_therapy" }],
      },
    });
  });

  it("skips validation and reports why rather than throwing when the context has no valid input", async () => {
    const service = new ClinicalValidationService([]);
    const step = createClinicalValidationStep(service);

    const patch = await step.execute(baseInstance({}));

    expect(patch).toEqual({ clinicalValidationSkippedReason: "missing_or_invalid_input" });
  });

  it("skips validation for a malformed input rather than passing it through to the domain service", async () => {
    const service = new ClinicalValidationService([]);
    const step = createClinicalValidationStep(service);

    const patch = await step.execute(
      baseInstance({ clinicalValidationInput: { medicineId: "med-1", patientAllergies: "not-an-array" } }),
    );

    expect(patch).toEqual({ clinicalValidationSkippedReason: "missing_or_invalid_input" });
  });
});
