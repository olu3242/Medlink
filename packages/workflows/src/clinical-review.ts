import type { ClinicalValidationInput, ClinicalValidationService } from "@medlink/clinical";
import type { WorkflowInstance, WorkflowStep } from "./service";

// packages/clinical's ClinicalValidationInput is a plain TS interface with
// no zod schema of its own (unlike packages/medicine's models) -- this
// guard is the runtime check that stands in for one, since a workflow
// instance's context arrives as untyped jsonb from persistence and must
// not be cast without verifying its shape first.
function isClinicalValidationInput(value: unknown): value is ClinicalValidationInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.medicineId === "string" &&
    Array.isArray(candidate.patientAllergies) &&
    candidate.patientAllergies.every((item) => typeof item === "string") &&
    Array.isArray(candidate.activeIngredientIds) &&
    candidate.activeIngredientIds.every((item) => typeof item === "string") &&
    Array.isArray(candidate.currentMedicineIds) &&
    candidate.currentMedicineIds.every((item) => typeof item === "string")
  );
}

// WF-007 Clinical Review's real, executable step -- the second canonical
// workflow definition in packages/workflows backed by an actual domain
// call (see medicine-search.ts for the first, WF-005). Reads
// `clinicalValidationInput` from the workflow instance's context and
// returns the validation result (findings, hasHardStop) as this step's
// context patch. Like medicine-search.ts, depends on @medlink/clinical
// directly rather than a further HTTP hop through a "versioned Experience
// API" -- the same acknowledged interim shortcut, mirroring apps/admin's
// own POST /api/v1/prescriptions/{id}/validate route, which already calls
// packages/clinical directly. Never auto-decides anything:
// ClinicalValidationService.validate() always sets
// requiresPharmacistReview: true, and this step doesn't touch that.
export function createClinicalValidationStep(service: ClinicalValidationService): WorkflowStep {
  return {
    name: "run_clinical_validation",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.clinicalValidationInput;
      if (!isClinicalValidationInput(input)) {
        return { clinicalValidationSkippedReason: "missing_or_invalid_input" };
      }
      return { clinicalValidationResult: service.validate(input) };
    },
  };
}

export interface DecideClinicalReviewInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly reviewId: string;
  readonly decision: "approved" | "rejected" | "needs_information";
  readonly recommendation: string;
}

export interface DecidedClinicalReview {
  readonly id: string;
  readonly decision: string;
}

// Like mar-creation.ts's MarCreator, a pharmacist's clinical review
// decision has no portable domain package to wrap -- it's a licensed
// human's judgment call recorded against the database (the
// decide_clinical_review RPC, migration 202607290017), not a computable
// domain rule. A concrete implementation belongs in the consuming app.
export interface ClinicalReviewDecider {
  decide(input: DecideClinicalReviewInput): Promise<DecidedClinicalReview>;
}

function isDecideClinicalReviewInput(value: unknown): value is DecideClinicalReviewInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.organizationId === "string" &&
    typeof candidate.actorId === "string" &&
    typeof candidate.reviewId === "string" &&
    (candidate.decision === "approved" ||
      candidate.decision === "rejected" ||
      candidate.decision === "needs_information") &&
    typeof candidate.recommendation === "string"
  );
}

// WF-007's second real step, "pharmacist_review" -- the decision half of
// Clinical Review, distinct from "run_clinical_validation" above (the
// advisory findings a pharmacist reviews before deciding). Reads
// `clinicalReviewDecisionInput` from the workflow context; a missing or
// malformed input skips the decision and reports why, the same pattern
// every other step in this package uses, rather than passing bad data to
// the RPC. Never auto-decides on its own: the decision value itself must
// already be present in the context, made by the human pharmacist through
// whatever channel captured it -- this step only records it atomically.
export function createPharmacistReviewStep(decider: ClinicalReviewDecider): WorkflowStep {
  return {
    name: "pharmacist_review",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.clinicalReviewDecisionInput;
      if (!isDecideClinicalReviewInput(input)) {
        return { pharmacistReviewSkippedReason: "missing_or_invalid_input" };
      }
      return { pharmacistReviewResult: await decider.decide(input) };
    },
  };
}
