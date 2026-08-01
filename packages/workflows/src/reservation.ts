import type { WorkflowInstance, WorkflowStep } from "./service";

export interface CreateReservationInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly marId: string;
  readonly pharmacyLocationId: string;
  readonly inventoryBatchId: string;
  readonly quantity: number;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
}

export interface CreatedReservation {
  readonly id: string;
  readonly status: string;
}

// Like MarCreator (mar-creation.ts) and ClinicalReviewDecider
// (clinical-review.ts), reservation creation has no portable domain
// package to wrap -- it's backed directly by the atomic reserve_inventory
// RPC (migration 202607290010). A concrete implementation belongs in the
// consuming app.
export interface ReservationCreator {
  createReservation(input: CreateReservationInput): Promise<CreatedReservation>;
}

function isCreateReservationInput(value: unknown): value is CreateReservationInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.organizationId === "string" &&
    typeof candidate.actorId === "string" &&
    typeof candidate.marId === "string" &&
    typeof candidate.pharmacyLocationId === "string" &&
    typeof candidate.inventoryBatchId === "string" &&
    typeof candidate.quantity === "number" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.idempotencyKey === "string"
  );
}

// WF-009 Reservation's real, executable "reserve_inventory" step -- the
// fourth canonical workflow definition in packages/workflows backed by an
// actual call (see medicine-search.ts, mar-creation.ts, and
// clinical-review.ts for the first three). Reads `createReservationInput`
// from the workflow context; a missing or malformed input skips reservation
// and reports why, the same pattern every other step in this package uses.
export function createReservationStep(creator: ReservationCreator): WorkflowStep {
  return {
    name: "reserve_inventory",
    async execute(instance: WorkflowInstance) {
      const input = instance.context.createReservationInput;
      if (!isCreateReservationInput(input)) {
        return { reservationSkippedReason: "missing_or_invalid_input" };
      }
      return { reservation: await creator.createReservation(input) };
    },
  };
}
