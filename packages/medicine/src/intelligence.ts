import type { z } from "zod";
import type { canonicalMedicineSchema } from "./canonical";
import { normalizedAmount, normalizedStrength, normalizedText } from "./formulation-normalization";

export type CanonicalMedicine = z.infer<typeof canonicalMedicineSchema>;

export interface MatchCriteria {
  readonly activeIngredient: boolean;
  readonly strength: boolean;
  readonly dosageForm: boolean;
  readonly route: boolean;
  readonly activeRegistration: boolean;
  readonly manufacturer: boolean;
  readonly pharmacyAvailability: boolean;
  readonly inStockOnly: boolean;
}

export type SearchPreset = "EXACT_EQUIVALENT" | "SAME_INGREDIENT" | "BROAD_CATALOG" | "AVAILABILITY";

export const defaultMatchCriteria: MatchCriteria = {
  activeIngredient: true,
  strength: true,
  dosageForm: true,
  route: true,
  activeRegistration: true,
  manufacturer: false,
  pharmacyAvailability: false,
  inStockOnly: false,
};

export function criteriaForPreset(preset: SearchPreset): MatchCriteria {
  if (preset === "SAME_INGREDIENT") {
    return { ...defaultMatchCriteria, strength: false, dosageForm: false, route: false };
  }
  if (preset === "BROAD_CATALOG") {
    return {
      ...defaultMatchCriteria,
      activeIngredient: false,
      strength: false,
      dosageForm: false,
      route: false,
      activeRegistration: false,
    };
  }
  if (preset === "AVAILABILITY") {
    return { ...defaultMatchCriteria, pharmacyAvailability: true, inStockOnly: true };
  }
  return { ...defaultMatchCriteria };
}

export type EquivalencyTier = "EXACT_EQUIVALENT" | "SAME_INGREDIENT_DIFFERENT_STRENGTH" | "SAME_INGREDIENT_DIFFERENT_FORM_OR_ROUTE" | "RELATED_CATALOG_MATCH";

export interface IntelligenceCandidate {
  readonly medicine: CanonicalMedicine;
  readonly tier: EquivalencyTier;
}

function ingredientIdentity(medicine: CanonicalMedicine): string[] {
  return medicine.ingredients
    .map(({ ingredientId }) => ingredientId)
    .sort();
}

export function sameIngredients(left: CanonicalMedicine, right: CanonicalMedicine): boolean {
  const a = ingredientIdentity(left);
  const b = ingredientIdentity(right);
  return a.length > 0 && new Set(a).size === a.length
    && new Set(b).size === b.length
    && a.length === b.length && a.every((value, index) => value === b[index]);
}

export function sameStrength(left: CanonicalMedicine, right: CanonicalMedicine): boolean {
  // Display strings alone do not establish ingredient amounts or ratios.
  const complete = (medicine: CanonicalMedicine) => medicine.ingredients.length > 0
    && medicine.ingredients.every(({ amount, unit }) =>
      amount !== null && Number.isFinite(amount) && amount > 0 && Boolean(unit?.trim()));
  if (!complete(left) || !complete(right) || !sameIngredients(left, right)) return false;
  return Boolean(left.normalizedStrength.trim())
    && normalizedStrength(left.normalizedStrength) === normalizedStrength(right.normalizedStrength)
    && left.ingredients.every((ingredient) => right.ingredients.some((other) =>
      ingredient.ingredientId === other.ingredientId
      && normalizedAmount(ingredient.amount, ingredient.unit) === normalizedAmount(other.amount, other.unit)));
}

export function activeRegistration(medicine: CanonicalMedicine, today: string): boolean {
  return medicine.registrations.some((registration) =>
    normalizedText(registration.authorityCode) === "nafdac"
    && normalizedText(registration.countryCode) === "ng"
    && Boolean(registration.registrationNumber.trim())
    && (!registration.validFrom || registration.validFrom <= today)
    && (!registration.validUntil || registration.validUntil >= today),
  );
}

export function classifyCandidate(
  reference: CanonicalMedicine,
  candidate: CanonicalMedicine,
  criteria: MatchCriteria,
  today = new Date().toISOString().slice(0, 10),
): IntelligenceCandidate | null {
  if (criteria.activeIngredient && !sameIngredients(reference, candidate)) return null;
  if (criteria.strength && !sameStrength(reference, candidate)) return null;
  if (criteria.dosageForm && normalizedText(reference.dosageForm) !== normalizedText(candidate.dosageForm)) return null;
  if (criteria.route && normalizedText(reference.route) !== normalizedText(candidate.route)) return null;
  if (criteria.manufacturer && reference.manufacturer !== candidate.manufacturer) return null;
  if (criteria.activeRegistration && !activeRegistration(candidate, today)) return null;
  if (criteria.inStockOnly || criteria.pharmacyAvailability) return null;

  if (sameIngredients(reference, candidate) && sameStrength(reference, candidate)
    && normalizedText(reference.dosageForm) === normalizedText(candidate.dosageForm) && normalizedText(reference.route) === normalizedText(candidate.route)
    && reference.status === "active" && candidate.status === "active"
    && activeRegistration(reference, today) && activeRegistration(candidate, today)) {
    return { medicine: candidate, tier: "EXACT_EQUIVALENT" };
  }
  if (sameIngredients(reference, candidate) && !sameStrength(reference, candidate)) {
    return { medicine: candidate, tier: "SAME_INGREDIENT_DIFFERENT_STRENGTH" };
  }
  if (sameIngredients(reference, candidate)
    && (normalizedText(reference.dosageForm) !== normalizedText(candidate.dosageForm) || normalizedText(reference.route) !== normalizedText(candidate.route))) {
    return { medicine: candidate, tier: "SAME_INGREDIENT_DIFFERENT_FORM_OR_ROUTE" };
  }
  return { medicine: candidate, tier: "RELATED_CATALOG_MATCH" };
}

export interface ResultFacets {
  readonly ingredients: readonly { value: string; count: number }[];
  readonly strengths: readonly { value: string; count: number }[];
  readonly dosageForms: readonly { value: string; count: number }[];
  readonly routes: readonly { value: string; count: number }[];
  readonly manufacturers: readonly { value: string; count: number }[];
  readonly regulatoryStatuses: readonly { value: string; count: number }[];
}

function countValues(values: readonly string[]): readonly { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, count }));
}

export function getFacets(candidates: readonly IntelligenceCandidate[], today = new Date().toISOString().slice(0, 10)): ResultFacets {
  return {
    ingredients: countValues(candidates.flatMap(({ medicine }) => medicine.ingredients.map(({ preferredName }) => preferredName))),
    strengths: countValues(candidates.map(({ medicine }) => medicine.strength)),
    dosageForms: countValues(candidates.map(({ medicine }) => medicine.dosageForm)),
    routes: countValues(candidates.map(({ medicine }) => medicine.route)),
    manufacturers: countValues(candidates.flatMap(({ medicine }) => medicine.manufacturer ? [medicine.manufacturer] : [])),
    regulatoryStatuses: countValues(candidates.map(({ medicine }) => activeRegistration(medicine, today) ? "active" : "inactive_or_missing")),
  };
}
