import { EquivalencyReviewRequiredError } from "./errors";
import type {
  BrandMedicine,
  IngredientStrength,
  MedicineReference,
} from "./models";
import type { MedicineCatalogReader } from "./repository";

export type EquivalencyReason =
  | "same_active_ingredients_strength_form_and_route"
  | "different_therapeutic_class"
  | "ingredient_mismatch"
  | "strength_mismatch"
  | "dosage_form_mismatch"
  | "route_mismatch"
  | "inactive_medicine";

export interface EquivalencyCandidate {
  readonly medicine: BrandMedicine;
  readonly eligible: boolean;
  readonly reason: EquivalencyReason;
  readonly decision: "pharmacist_review_required";
  readonly mayAutoSubstitute: false;
}

export interface PharmacistEquivalencyDecision {
  readonly candidateBrandId: string;
  readonly approved: boolean;
  readonly pharmacistId: string;
  readonly reviewedAt: Date;
  readonly rationale: string;
}

export interface EquivalencyService {
  propose(reference: MedicineReference): Promise<readonly EquivalencyCandidate[]>;
  assertReviewed(decision: PharmacistEquivalencyDecision | null): void;
}

function ingredientKey(ingredient: IngredientStrength): string {
  return `${ingredient.genericId}:${ingredient.amount}:${ingredient.unit}`;
}

function sameIngredients(
  left: readonly IngredientStrength[],
  right: readonly IngredientStrength[],
): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = [...left].map(ingredientKey).sort();
  const rightKeys = [...right].map(ingredientKey).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

function reasonFor(
  reference: MedicineReference,
  candidate: BrandMedicine,
): EquivalencyReason {
  if (candidate.status !== "active") return "inactive_medicine";
  if (candidate.dosageForm !== reference.dosageForm) return "dosage_form_mismatch";
  if (candidate.route !== reference.route) return "route_mismatch";

  const candidateIds = new Set(candidate.ingredients.map(({ genericId }) => genericId));
  const referenceIds = new Set(reference.ingredients.map(({ genericId }) => genericId));
  if (
    candidateIds.size !== referenceIds.size ||
    [...referenceIds].some((id) => !candidateIds.has(id))
  ) {
    return "ingredient_mismatch";
  }
  if (!sameIngredients(candidate.ingredients, reference.ingredients)) {
    return "strength_mismatch";
  }
  return "same_active_ingredients_strength_form_and_route";
}

export class CatalogEquivalencyService implements EquivalencyService {
  constructor(private readonly catalog: MedicineCatalogReader) {}

  async propose(
    reference: MedicineReference,
  ): Promise<readonly EquivalencyCandidate[]> {
    const genericIds = [...new Set(reference.ingredients.map(({ genericId }) => genericId))];
    const candidates = await this.catalog.findBrandsByIngredientIds(genericIds);

    return candidates
      .filter(({ id }) => id !== reference.brandId)
      .map((medicine) => {
        const reason = reasonFor(reference, medicine);
        return {
          medicine,
          eligible: reason === "same_active_ingredients_strength_form_and_route",
          reason,
          decision: "pharmacist_review_required" as const,
          mayAutoSubstitute: false as const,
        };
      });
  }

  assertReviewed(decision: PharmacistEquivalencyDecision | null): void {
    if (
      decision === null ||
      decision.pharmacistId.trim() === "" ||
      decision.rationale.trim() === ""
    ) {
      throw new EquivalencyReviewRequiredError();
    }
  }
}
