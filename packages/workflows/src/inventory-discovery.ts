import type { WorkflowInstance, WorkflowStep } from "./service";

export interface FindAvailableInventoryInput {
  readonly organizationId: string;
  readonly term: string | null;
}

export interface AvailableInventoryMatch {
  readonly inventoryId: string;
  readonly medicineName: string;
  readonly pharmacyName: string;
  readonly pharmacyLocality: string | null;
  readonly stockStatus: string;
}

// Like MarCreator (mar-creation.ts), ReservationCreator (reservation.ts),
// and ClinicalReviewDecider (clinical-review.ts), inventory discovery has
// no portable domain package to wrap -- it's a filtered read against
// inventory_batches (apps/patient/lib/application.ts's `inventory()`), not
// a computable domain rule. A concrete implementation belongs in the
// consuming app.
export interface InventoryFinder {
  findAvailable(input: FindAvailableInventoryInput): Promise<readonly AvailableInventoryMatch[]>;
}

function isFindAvailableInventoryInput(value: unknown): value is FindAvailableInventoryInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.organizationId === "string" &&
    (candidate.term === null || typeof candidate.term === "string")
  );
}

// WF-008 Inventory Discovery's real, executable "search_inventory" step.
// Reads `findAvailableInventoryInput` from the workflow context; a missing
// or malformed input skips the search and reports why, the same pattern
// every other step in this package uses. "match_inventory" (the second
// structural step in definitions.ts) has no implementation yet -- matching
// a specific batch to a MAR is a distinct decision this step's plain
// availability search doesn't make.
export function createInventoryDiscoveryStep(finder: InventoryFinder): WorkflowStep {
  return {
    name: "search_inventory",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.findAvailableInventoryInput;
      if (!isFindAvailableInventoryInput(input)) {
        return { inventoryDiscoverySkippedReason: "missing_or_invalid_input" };
      }
      return { availableInventory: await finder.findAvailable(input) };
    },
  };
}
