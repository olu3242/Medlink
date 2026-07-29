import { describe, expect, it } from "vitest";
import type { WorkflowInstance } from "./service";
import {
  createReservationStep,
  type CreateReservationInput,
  type CreatedReservation,
  type ReservationCreator,
} from "./reservation";

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "reservation",
    status: "running",
    completedSteps: [],
    context,
  };
}

class RecordingReservationCreator implements ReservationCreator {
  readonly calls: CreateReservationInput[] = [];
  constructor(private readonly result: CreatedReservation) {}

  async createReservation(input: CreateReservationInput): Promise<CreatedReservation> {
    this.calls.push(input);
    return this.result;
  }
}

const validInput: CreateReservationInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  marId: "00000000-0000-4000-8000-000000000003",
  pharmacyLocationId: "00000000-0000-4000-8000-000000000004",
  inventoryBatchId: "00000000-0000-4000-8000-000000000005",
  quantity: 1,
  expiresAt: "2026-08-01T00:00:00.000Z",
  idempotencyKey: "wamid.001",
};

describe("createReservationStep", () => {
  it("creates a reservation using the input from the workflow context and returns it", async () => {
    const creator = new RecordingReservationCreator({ id: "reservation-1", status: "pending" });
    const step = createReservationStep(creator);

    const patch = await step.execute(baseInstance({ createReservationInput: validInput }));

    expect(creator.calls).toEqual([validInput]);
    expect(patch).toEqual({ reservation: { id: "reservation-1", status: "pending" } });
  });

  it("skips reservation and reports why rather than calling the creator with a missing input", async () => {
    const creator = new RecordingReservationCreator({ id: "reservation-1", status: "pending" });
    const step = createReservationStep(creator);

    const patch = await step.execute(baseInstance({}));

    expect(creator.calls).toHaveLength(0);
    expect(patch).toEqual({ reservationSkippedReason: "missing_or_invalid_input" });
  });

  it("skips reservation for a malformed input rather than passing it through to the RPC", async () => {
    const creator = new RecordingReservationCreator({ id: "reservation-1", status: "pending" });
    const step = createReservationStep(creator);

    const patch = await step.execute(
      baseInstance({ createReservationInput: { ...validInput, quantity: "one" } }),
    );

    expect(creator.calls).toHaveLength(0);
    expect(patch).toEqual({ reservationSkippedReason: "missing_or_invalid_input" });
  });
});
