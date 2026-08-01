import { describe, expect, it } from "vitest";
import { ClinicalValidationService, DuplicateTherapyRule } from "@medlink/clinical";
import type { WorkflowInstance } from "./service";
import {
  createClinicalValidationStep,
  createPharmacistReviewStep,
  type ClinicalReviewDecider,
  type DecideClinicalReviewInput,
  type DecidedClinicalReview,
} from "./clinical-review";

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

class RecordingClinicalReviewDecider implements ClinicalReviewDecider {
  readonly calls: DecideClinicalReviewInput[] = [];
  constructor(private readonly result: DecidedClinicalReview) {}

  async decide(input: DecideClinicalReviewInput): Promise<DecidedClinicalReview> {
    this.calls.push(input);
    return this.result;
  }
}

const validDecisionInput: DecideClinicalReviewInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  reviewId: "00000000-0000-4000-8000-000000000003",
  decision: "approved",
  recommendation: "No interactions found; safe to dispense.",
};

describe("createPharmacistReviewStep", () => {
  it("records the decision from the workflow context and returns the result", async () => {
    const decider = new RecordingClinicalReviewDecider({ id: "review-1", decision: "approved" });
    const step = createPharmacistReviewStep(decider);

    const patch = await step.execute(
      { id: "w", tenantId: "t", type: "clinical_review", status: "running", completedSteps: [], context: { clinicalReviewDecisionInput: validDecisionInput } },
    );

    expect(decider.calls).toEqual([validDecisionInput]);
    expect(patch).toEqual({ pharmacistReviewResult: { id: "review-1", decision: "approved" } });
  });

  it("skips the decision and reports why rather than calling the decider with a missing input", async () => {
    const decider = new RecordingClinicalReviewDecider({ id: "review-1", decision: "approved" });
    const step = createPharmacistReviewStep(decider);

    const patch = await step.execute(
      { id: "w", tenantId: "t", type: "clinical_review", status: "running", completedSteps: [], context: {} },
    );

    expect(decider.calls).toHaveLength(0);
    expect(patch).toEqual({ pharmacistReviewSkippedReason: "missing_or_invalid_input" });
  });

  it("skips the decision for an out-of-vocabulary decision value rather than passing it through", async () => {
    const decider = new RecordingClinicalReviewDecider({ id: "review-1", decision: "approved" });
    const step = createPharmacistReviewStep(decider);

    const patch = await step.execute({
      id: "w",
      tenantId: "t",
      type: "clinical_review",
      status: "running",
      completedSteps: [],
      context: { clinicalReviewDecisionInput: { ...validDecisionInput, decision: "changes_requested" } },
    });

    expect(decider.calls).toHaveLength(0);
    expect(patch).toEqual({ pharmacistReviewSkippedReason: "missing_or_invalid_input" });
  });
});
