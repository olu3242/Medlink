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

export class AllergyConflictRule implements ClinicalRule {
  readonly id = "allergy_conflict";

  evaluate(input: ClinicalValidationInput): readonly ValidationFinding[] {
    const normalizedAllergies = new Set(
      input.patientAllergies.map((value) => value.trim().toLocaleLowerCase("en")),
    );
    const conflict = input.activeIngredientIds.find((ingredient) =>
      normalizedAllergies.has(ingredient.trim().toLocaleLowerCase("en")));
    if (!conflict) return [];
    return [{
      code: this.id,
      severity: "critical",
      summary: "A prescribed ingredient conflicts with a recorded allergy.",
      source: "patient.allergies",
      requiresAcknowledgement: true,
    }];
  }
}

export class ClinicalAcknowledgementService {
  acknowledge(input: {
    result: ClinicalValidationResult;
    pharmacistId: string;
    rationale: string;
  }): { acknowledgedBy: string; acknowledgedAt: string } {
    if (
      !input.result.hasHardStop
      || input.pharmacistId.trim() === ""
      || input.rationale.trim().length < 3
    ) {
      throw new Error("A pharmacist rationale is required for a clinical hard stop");
    }
    return {
      acknowledgedBy: input.pharmacistId,
      acknowledgedAt: new Date().toISOString(),
    };
  }
}
