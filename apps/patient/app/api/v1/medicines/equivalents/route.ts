import { SupabaseCanonicalMedicineRepository, activeRegistration, formulationFilters, formulationGroup, matchesFormulationFilters, formulationDifferences, prepareOffers, sortFormulationResults, ratioFacets, unitFacets, INVENTORY_FRESHNESS_HOURS } from "@medlink/medicine";
import { createMedLinkLogger } from "@medlink/observability";
import type { MedicationDiscoveryOption } from "@medlink/pharmacy";
import { RuntimeError } from "@medlink/runtime";
import { runApi } from "../../../../../lib/api-server";
import { AccessApplication } from "../../../../../lib/application";
const logger = createMedLinkLogger();

export const GET = (request: Request) => runApi(request, {
  name: "patient.medicines.equivalents",
  permission: "inventory:read",
  schema: formulationFilters,
  input: async (value) => {
    const params = new URL(value.url).searchParams;
    return { ...Object.fromEntries(params), ingredient: params.getAll("ingredient") };
  },
  execute: async (rawInput, context, database) => {
    const started = performance.now();
    let phase = "catalogue";
    try {
    if (context.role !== "patient") throw new RuntimeError("authorization", "patient_context_required", "A patient context is required", 403, false);
    const input = formulationFilters.parse(rawInput);
    const signal = AbortSignal.timeout(15000);
    const repository = new SupabaseCanonicalMedicineRepository(database, signal);
    const reference = await repository.find(input.medicineId);
    if (!reference || reference.status !== "active") throw new RuntimeError("validation", "medicine_not_found", "Select an active prescribed product", 404, false);
    const candidates = await repository.formulationCandidates(reference);
    const classified = candidates.medicines.flatMap((medicine) => {
      const group = formulationGroup(reference, medicine, candidates.therapeuticIds);
      return group ? [{ medicine, group, differences: formulationDifferences(reference, medicine), assessmentRequired: true as const }] : [];
    });
    const facets = {
      ingredients: [...new Map(classified.flatMap(({ medicine }) => medicine.ingredients.map((item) => [item.ingredientId, item.preferredName] as const)))].map(([id, name]) => ({ id, name })),
      strengths: [...new Set(classified.map(({ medicine }) => medicine.strength))].sort(),
      forms: [...new Set(classified.map(({ medicine }) => medicine.dosageForm))].sort(),
      routes: [...new Set(classified.map(({ medicine }) => medicine.route))].sort(),
      brands: [...new Set(classified.map(({ medicine }) => medicine.brandName))].sort(),
      manufacturers: [...new Set(classified.flatMap(({ medicine }) => medicine.manufacturer ? [medicine.manufacturer] : []))].sort(),
      units: unitFacets(classified.map(({ medicine }) => medicine)),
      ratios: ratioFacets(classified.map(({ medicine }) => medicine)),
    };
    const application = new AccessApplication(database, signal);
    const results: Array<(typeof classified)[number] & { registered: boolean; offers: ReturnType<typeof prepareOffers<MedicationDiscoveryOption>> }> = [];
    let staleCount = 0;
    phase = "inventory";
    for (const candidate of classified.filter(({ medicine, group }) => matchesFormulationFilters(medicine, group, input))) {
      let offers: MedicationDiscoveryOption[] = [];
      if (input.latitude !== undefined && input.longitude !== undefined) {
        const inventory = await application.eligiblePharmacies(context, {
          medicineId: candidate.medicine.id, latitude: input.latitude, longitude: input.longitude,
          radiusKm: input.radiusKm, locationConsent: input.locationConsent === "true", includeContact: true,
        });
        offers = [...inventory.exact];
      }
      const prepared = prepareOffers(offers, candidate.group, input, Date.now());
      staleCount += prepared.filter((offer) => offer.freshness !== "fresh").length;
      if (!prepared.length && (input.availability !== "all" || input.pharmacy || input.minPrice !== undefined || input.maxPrice !== undefined)) continue;
      results.push({ ...candidate, registered: activeRegistration(candidate.medicine, new Date().toISOString().slice(0, 10)), offers: prepared });
    }
    sortFormulationResults(results, reference.id, input.sort);
    const groupCounts = { exact: results.filter((item) => item.group === "exact").length, related: results.filter((item) => item.group === "related").length, therapeutic: results.filter((item) => item.group === "therapeutic").length };
    logger.info({ event: "medicine_search_completed", source: "INTERNAL_CATALOGUE", durationMs: Math.round(performance.now() - started), resultCount: results.length, zeroResults: results.length === 0, groupCounts, staleCount });
    return { source: "INTERNAL_CATALOGUE" as const, reference, facets,
      results: results.slice(input.offset, input.offset + input.limit),
      pagination: { total: results.length, offset: input.offset, limit: input.limit, nextOffset: input.offset + input.limit < results.length ? input.offset + input.limit : null },
      groupCounts, freshnessHours: INVENTORY_FRESHNESS_HOURS, availabilityChecked: input.latitude !== undefined };
    } catch (error) {
      logger.warn({ event: "medicine_search_failed", source: "INTERNAL_CATALOGUE", phase, durationMs: Math.round(performance.now() - started) });
      throw error;
    }
  },
  success: (data) => Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } }),
});
