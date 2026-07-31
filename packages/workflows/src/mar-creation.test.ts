import { describe, expect, it } from "vitest";
import type { WorkflowInstance } from "./service";
import { createMarCreationStep, type CreateMarInput, type CreatedMar, type MarCreator } from "./mar-creation";

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "mar_create",
    status: "running",
    completedSteps: [],
    context,
  };
}

class RecordingMarCreator implements MarCreator {
  readonly calls: CreateMarInput[] = [];
  constructor(private readonly result: CreatedMar) {}

  async createMar(input: CreateMarInput): Promise<CreatedMar> {
    this.calls.push(input);
    return this.result;
  }
}

const validInput: CreateMarInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  actorId: "00000000-0000-4000-8000-000000000002",
  patientId: "00000000-0000-4000-8000-000000000002",
  medicineId: "00000000-0000-4000-8000-000000000003",
  prescriptionId: null,
  notes: null,
  idempotencyKey: "wamid.001",
};

describe("createMarCreationStep", () => {
  it("creates a MAR using the input from the workflow context and returns it", async () => {
    const creator = new RecordingMarCreator({ id: "mar-1", state: "created" });
    const step = createMarCreationStep(creator);

    const patch = await step.execute(baseInstance({ createMarInput: validInput }));

    expect(creator.calls).toEqual([validInput]);
    expect(patch).toEqual({ mar: { id: "mar-1", state: "created" } });
  });

  it("skips creation and reports why rather than calling the creator with a missing input", async () => {
    const creator = new RecordingMarCreator({ id: "mar-1", state: "created" });
    const step = createMarCreationStep(creator);

    const patch = await step.execute(baseInstance({}));

    expect(creator.calls).toHaveLength(0);
    expect(patch).toEqual({ marCreationSkippedReason: "missing_or_invalid_input" });
  });

  it("skips creation for a malformed input rather than passing it through to the RPC", async () => {
    const creator = new RecordingMarCreator({ id: "mar-1", state: "created" });
    const step = createMarCreationStep(creator);

    const patch = await step.execute(
      baseInstance({ createMarInput: { ...validInput, medicineId: 42 } }),
    );

    expect(creator.calls).toHaveLength(0);
    expect(patch).toEqual({ marCreationSkippedReason: "missing_or_invalid_input" });
  });
});
