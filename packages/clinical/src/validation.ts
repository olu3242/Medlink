import { z } from "zod";

export const validationSeveritySchema = z.enum(["info", "warning", "critical"]);
export const validationFindingSchema = z.object({
  code: z.string().min(1),
  severity: validationSeveritySchema,
  summary: z.string().min(1),
  source: z.string().min(1),
  requiresAcknowledgement: z.boolean(),
});

export type ValidationFinding = z.infer<typeof validationFindingSchema>;

export interface ClinicalRule {
  readonly id: string;
  evaluate(input: ClinicalValidationInput): readonly ValidationFinding[];
}

export interface ClinicalValidationInput {
  readonly medicineId: string;
  readonly patientAllergies: readonly string[];
  readonly activeIngredientIds: readonly string[];
  readonly currentMedicineIds: readonly string[];
}

export interface ClinicalValidationResult {
  readonly findings: readonly ValidationFinding[];
  readonly requiresPharmacistReview: true;
  readonly hasHardStop: boolean;
}

export class ClinicalValidationService {
  constructor(private readonly rules: readonly ClinicalRule[]) {}

  validate(input: ClinicalValidationInput): ClinicalValidationResult {
    const findings = this.rules.flatMap((rule) => rule.evaluate(input));
    return {
      findings,
      requiresPharmacistReview: true,
      hasHardStop: findings.some(
        (finding) =>
          finding.severity === "critical" && finding.requiresAcknowledgement,
      ),
    };
  }
}

export class DuplicateTherapyRule implements ClinicalRule {
  readonly id = "duplicate_therapy";

  evaluate(input: ClinicalValidationInput): readonly ValidationFinding[] {
    if (!input.currentMedicineIds.includes(input.medicineId)) return [];
    return [
      {
        code: this.id,
        severity: "warning",
        summary: "The requested medicine is already active for this patient.",
        source: "patient.current_medications",
        requiresAcknowledgement: true,
      },
    ];
  }
}

// Matches a candidate medicine's active ingredients against the patient's
// declared allergies. patientAllergies is caller-supplied free text (there
// is no ingredient-name resolution in this package), so this does an exact,
// case-insensitive match against activeIngredientIds rather than fuzzy
// text matching - a caller passing allergy values in the same identifier
// space as activeIngredientIds gets a real check; a caller passing prose
// ("penicillin") gets a safe no-match rather than a false one. Either way
// this only ever produces an advisory finding requiring pharmacist
// acknowledgement, never a decision.
export class PatientAllergyRule implements ClinicalRule {
  readonly id = "allergy";

  evaluate(input: ClinicalValidationInput): readonly ValidationFinding[] {
    const allergies = new Set(
      input.patientAllergies.map((allergy) => allergy.trim().toLowerCase()).filter(Boolean),
    );
    if (allergies.size === 0) return [];
    const matched = input.activeIngredientIds.some(
      (ingredientId) => allergies.has(ingredientId.trim().toLowerCase()),
    );
    if (!matched) return [];
    return [
      {
        code: this.id,
        severity: "critical",
        summary: "The patient has a declared allergy matching one of this medicine's active ingredients.",
        source: "patient.allergies",
        requiresAcknowledgement: true,
      },
    ];
  }
}

const POLYPHARMACY_CONCURRENT_MEDICINE_THRESHOLD = 5;

// Flags polypharmacy risk (a patient on several concurrent medications faces
// materially higher interaction and adherence risk - a well-established
// clinical heuristic, not a specific interaction claim) using only the
// count already available on the input. Does not attempt real interaction
// checking between specific drugs.
export class PolypharmacyRiskRule implements ClinicalRule {
  readonly id = "polypharmacy_risk";

  evaluate(input: ClinicalValidationInput): readonly ValidationFinding[] {
    if (input.currentMedicineIds.length < POLYPHARMACY_CONCURRENT_MEDICINE_THRESHOLD) return [];
    return [
      {
        code: this.id,
        severity: "warning",
        summary: `The patient is currently on ${input.currentMedicineIds.length} other medications; review for interaction and polypharmacy risk.`,
        source: "patient.current_medications",
        requiresAcknowledgement: true,
      },
    ];
  }
}
