import type { CanonicalMedicine } from "./intelligence";
import { matchesStockFilter, type FormulationFilters, type FormulationGroup } from "./formulation-search";

export const INVENTORY_FRESHNESS_HOURS = 24;
export interface FormulationOffer {
  inventoryId: string;
  pharmacyName: string;
  pharmacyLocationId: string;
  distanceKm: number;
  stockStatus: string;
  inventoryTimestamp: string;
  unitPriceMinor: number | null;
  currencyCode: string | null;
  reservationEligible: boolean;
  pharmacistReviewRequired: boolean;
}
export function inventoryFreshness(timestamp: string, now: number): "fresh" | "stale" | "unknown" {
  const observed = Date.parse(timestamp);
  if (!Number.isFinite(observed) || observed > now) return "unknown";
  return now - observed <= INVENTORY_FRESHNESS_HOURS * 3600000 ? "fresh" : "stale";
}
export function prepareOffers<T extends FormulationOffer>(offers: readonly T[], group: FormulationGroup, filters: FormulationFilters, now: number) {
  const prepared = offers.map((offer) => {
    const freshness = inventoryFreshness(offer.inventoryTimestamp, now);
    return { ...offer, freshness,
      reservationEligible: offer.reservationEligible && group === "exact" && freshness === "fresh",
      pharmacistReviewRequired: true as const,
    };
  }).filter((offer) => (!filters.pharmacy || offer.pharmacyName.toLowerCase().includes(filters.pharmacy.toLowerCase()))
    && offer.distanceKm <= filters.radiusKm
    && matchesStockFilter(offer.stockStatus, filters.availability)
    && (filters.availability === "all" || offer.freshness === "fresh")
    && (filters.minPrice === undefined || (offer.currencyCode === "NGN" && offer.unitPriceMinor !== null && offer.unitPriceMinor >= filters.minPrice * 100))
    && (filters.maxPrice === undefined || (offer.currencyCode === "NGN" && offer.unitPriceMinor !== null && offer.unitPriceMinor <= filters.maxPrice * 100)));
  return prepared.sort((a, b) => offerRank(a, filters.sort) - offerRank(b, filters.sort)
    || a.distanceKm - b.distanceKm || price(a) - price(b)
    || timestamp(b) - timestamp(a) || a.pharmacyLocationId.localeCompare(b.pharmacyLocationId)
    || a.inventoryId.localeCompare(b.inventoryId));
}
const price = (offer?: FormulationOffer) => offer?.currencyCode === "NGN" ? offer.unitPriceMinor ?? Infinity : Infinity;
const timestamp = (offer?: FormulationOffer) => Date.parse(offer?.inventoryTimestamp ?? "") || 0;
function offerRank(offer: FormulationOffer | undefined, sort: FormulationFilters["sort"]) {
  return sort === "price" ? price(offer) : sort === "freshness" ? -timestamp(offer) : offer?.distanceKm ?? Infinity;
}
export function sortFormulationResults<T extends { medicine: CanonicalMedicine; group: FormulationGroup; offers: FormulationOffer[] }>(results: T[], referenceId: string, sort: FormulationFilters["sort"]) {
  const groups = { exact: 0, related: 1, therapeutic: 2 };
  return results.sort((a, b) => groups[a.group] - groups[b.group]
    || (sort === "brand" ? a.medicine.brandName.localeCompare(b.medicine.brandName)
      : sort === "exact" ? Number(b.medicine.id === referenceId) - Number(a.medicine.id === referenceId)
        || offerRank(a.offers[0], sort) - offerRank(b.offers[0], sort)
      : offerRank(a.offers[0], sort) - offerRank(b.offers[0], sort))
    || price(a.offers[0]) - price(b.offers[0]) || timestamp(b.offers[0]) - timestamp(a.offers[0])
    || a.medicine.brandName.localeCompare(b.medicine.brandName) || a.medicine.id.localeCompare(b.medicine.id));
}
