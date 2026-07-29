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
