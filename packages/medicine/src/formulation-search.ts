import { z } from "zod";
import { activeRegistration, classifyCandidate, criteriaForPreset, sameIngredients, sameStrength, type CanonicalMedicine } from "./intelligence";
import { normalizedAmount, normalizedText } from "./formulation-normalization";

export const formulationFilters = z.object({
  medicineId: z.string().uuid(),
  ingredient: z.array(z.string().uuid()).default([]),
  quality: z.enum(["all", "exact", "related", "therapeutic"]).default("all"),
  strength: z.string().max(100).optional(),
  form: z.string().max(100).optional(),
  route: z.string().max(100).optional(),
  brand: z.string().max(200).optional(),
  manufacturer: z.string().max(200).optional(),
  registered: z.enum(["true", "false"]).default("false"),
  availability: z.enum(["all", "in_stock", "low_stock"]).default("all"),
  pharmacy: z.string().max(200).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  locationConsent: z.literal("true").optional(),
  radiusKm: z.coerce.number().min(1).max(200).default(25),
  sort: z.enum(["nearest", "price", "exact", "freshness", "brand"]).default("exact"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
}).superRefine((value, context) => {
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice)
    context.addIssue({ code: "custom", path: ["maxPrice"], message: "Maximum price must be at least minimum price" });
  if ((value.latitude !== undefined || value.longitude !== undefined)
    && (value.latitude === undefined || value.longitude === undefined || value.locationConsent !== "true"))
    context.addIssue({ code: "custom", path: ["latitude"], message: "Coordinates require location consent and both latitude and longitude" });
});
export type FormulationFilters = z.infer<typeof formulationFilters>;
export type FormulationGroup = "exact" | "related" | "therapeutic";
export function matchesStockFilter(state: string, filter: FormulationFilters["availability"]) {
  const normalized = state.toLowerCase();
  return filter === "all" || (filter === "low_stock" ? normalized === "low_stock"
    : normalized === "in_stock" || normalized === "low_stock");
}
export function formulationGroup(reference: CanonicalMedicine, candidate: CanonicalMedicine, therapeuticIds: readonly string[]): FormulationGroup | null {
  if (reference.status !== "active" || candidate.status !== "active") return null;
  const match = classifyCandidate(reference, candidate, criteriaForPreset("BROAD_CATALOG"));
  if (match?.tier === "EXACT_EQUIVALENT") return "exact";
  if (match?.tier === "SAME_INGREDIENT_DIFFERENT_STRENGTH"
    || match?.tier === "SAME_INGREDIENT_DIFFERENT_FORM_OR_ROUTE") return "related";
  // Incomplete or unregistered same-ingredient records remain review-only.
  if (sameIngredients(reference, candidate)) return "related";
  return therapeuticIds.includes(candidate.id) ? "therapeutic" : null;
}
export function formulationDifferences(reference: CanonicalMedicine, candidate: CanonicalMedicine): string[] {
  const differences: string[] = [];
  if (!sameIngredients(reference, candidate)) differences.push("active ingredients");
  if (reference.ingredients.length === 0 || candidate.ingredients.length === 0
    || [...reference.ingredients, ...candidate.ingredients].some((item) => normalizedAmount(item.amount, item.unit) === null)) differences.push("incomplete ingredient amounts");
  else if (reference.ingredients.some((item) => {
    const other = candidate.ingredients.find((value) => value.ingredientId === item.ingredientId);
    return !other || normalizedAmount(item.amount, item.unit) !== normalizedAmount(other.amount, other.unit);
  })) differences.push("ingredient amounts or ratios");
  if (!sameStrength(reference, candidate)) differences.push("strength");
  if (normalizedText(reference.dosageForm) !== normalizedText(candidate.dosageForm)) differences.push("dosage form");
  if (normalizedText(reference.route) !== normalizedText(candidate.route)) differences.push("route");
  const today = new Date().toISOString().slice(0, 10);
  if (!activeRegistration(reference, today) || !activeRegistration(candidate, today)) differences.push("unverified current NAFDAC registration");
  return differences;
}
export function matchesFormulationFilters(medicine: CanonicalMedicine, group: FormulationGroup, filters: FormulationFilters) {
  return (filters.quality === "all" || filters.quality === group)
    && filters.ingredient.every((id) => medicine.ingredients.some((item) => item.ingredientId === id))
    && (!filters.strength || medicine.strength === filters.strength)
    && (!filters.form || medicine.dosageForm === filters.form)
    && (!filters.route || medicine.route === filters.route)
    && (!filters.brand || medicine.brandName === filters.brand)
    && (!filters.manufacturer || medicine.manufacturer === filters.manufacturer)
    && (filters.registered !== "true" || activeRegistration(medicine, new Date().toISOString().slice(0, 10)));
}
