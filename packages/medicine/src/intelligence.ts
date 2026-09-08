import type { z } from "zod";
import type { canonicalMedicineSchema } from "./canonical";

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

function sameIngredients(left: CanonicalMedicine, right: CanonicalMedicine): boolean {
  const a = ingredientIdentity(left);
  const b = ingredientIdentity(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameStrength(left: CanonicalMedicine, right: CanonicalMedicine): boolean {
  return left.normalizedStrength === right.normalizedStrength;
}

function activeRegistration(medicine: CanonicalMedicine, today: string): boolean {
  return medicine.registrations.some((registration) =>
    registration.authorityCode === "NAFDAC"
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
  if (criteria.dosageForm && reference.dosageForm !== candidate.dosageForm) return null;
  if (criteria.route && reference.route !== candidate.route) return null;
  if (criteria.manufacturer && reference.manufacturer !== candidate.manufacturer) return null;
  if (criteria.activeRegistration && !activeRegistration(candidate, today)) return null;
  if (criteria.inStockOnly || criteria.pharmacyAvailability) return null;

  if (sameIngredients(reference, candidate) && sameStrength(reference, candidate)
    && reference.dosageForm === candidate.dosageForm && reference.route === candidate.route
    && candidate.status === "active" && activeRegistration(candidate, today)) {
    return { medicine: candidate, tier: "EXACT_EQUIVALENT" };
  }
  if (sameIngredients(reference, candidate) && !sameStrength(reference, candidate)) {
    return { medicine: candidate, tier: "SAME_INGREDIENT_DIFFERENT_STRENGTH" };
  }
  if (sameIngredients(reference, candidate)
    && (reference.dosageForm !== candidate.dosageForm || reference.route !== candidate.route)) {
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