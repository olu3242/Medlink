import type { EligiblePharmacyResult } from "./service";

export const medicationAvailabilityOutcomes = [
  "EXACT_BRAND_AVAILABLE",
  "GENERIC_AVAILABLE",
  "BOTH_AVAILABLE",
  "NONE_AVAILABLE",
  "AVAILABILITY_UNCERTAIN",
  "CLARIFICATION_REQUIRED",
  "PHARMACIST_REVIEW_REQUIRED",
] as const;

export type MedicationAvailabilityOutcome =
  (typeof medicationAvailabilityOutcomes)[number];

export interface MedicationDiscoveryOption {
  readonly relationship: "exact" | "generic_related";
  readonly medicineId: string;
  readonly medicineName: string;
  readonly inventoryId: string;
  readonly pharmacyLocationId: string;
  readonly pharmacyName: string;
  readonly pharmacyLocality?: string;
  readonly distanceKm: number;
  readonly stockStatus: string;
  readonly expiresOn?: string;
  readonly inventoryTimestamp: string;
  readonly unitPriceMinor: number | null;
  readonly currencyCode: string | null;
  readonly priceStatus: "AVAILABLE" | "PRICE_NOT_AVAILABLE";
  readonly reservationEligible: boolean;
  readonly pharmacistReviewRequired: boolean;
}

export interface MedicationDiscoveryResult {
  readonly requestedMedicineId: string;
  readonly outcome: MedicationAvailabilityOutcome;
  readonly exact: readonly MedicationDiscoveryOption[];
  readonly generic: readonly MedicationDiscoveryOption[];
}

function option(
  relationship: MedicationDiscoveryOption["relationship"],
  result: EligiblePharmacyResult,
): MedicationDiscoveryOption {
  const generic = relationship === "generic_related";
  const priceAvailable = result.inventory.unitPriceMinor !== null
    && result.inventory.currencyCode !== null;
  return {
    relationship,
    medicineId: result.inventory.medicineId,
    medicineName: result.inventory.medicineName,
    inventoryId: result.inventory.inventoryId,
    pharmacyLocationId: result.pharmacy.id,
    pharmacyName: result.pharmacy.name,
    distanceKm: result.distanceKm,
    stockStatus: result.inventory.state,
    expiresOn: result.inventory.expiresOn,
    inventoryTimestamp: result.inventory.observedAt,
    unitPriceMinor: priceAvailable ? result.inventory.unitPriceMinor : null,
    currencyCode: priceAvailable ? result.inventory.currencyCode : null,
    priceStatus: priceAvailable ? "AVAILABLE" : "PRICE_NOT_AVAILABLE",
    reservationEligible: !generic,
    pharmacistReviewRequired: generic,
  };
}

export function classifyMedicationDiscovery(input: {
  readonly requestedMedicineId: string;
  readonly exact: readonly EligiblePharmacyResult[];
  readonly generic: readonly EligiblePharmacyResult[];
}): MedicationDiscoveryResult {
  const exact = input.exact.map((result) => option("exact", result));
  const generic = input.generic.map((result) => option("generic_related", result));
  const outcome = exact.length > 0 && generic.length > 0
    ? "BOTH_AVAILABLE"
    : exact.length > 0
      ? "EXACT_BRAND_AVAILABLE"
      : generic.length > 0
        ? "GENERIC_AVAILABLE"
        : "NONE_AVAILABLE";
  return { requestedMedicineId: input.requestedMedicineId, outcome, exact, generic };
}
