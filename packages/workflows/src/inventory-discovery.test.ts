import { describe, expect, it } from "vitest";
import type { WorkflowInstance } from "./service";
import {
  createInventoryDiscoveryStep,
  type AvailableInventoryMatch,
  type FindAvailableInventoryInput,
  type InventoryFinder,
} from "./inventory-discovery";

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "inventory_discovery",
    status: "running",
    completedSteps: [],
    context,
  };
}

class RecordingInventoryFinder implements InventoryFinder {
  readonly calls: FindAvailableInventoryInput[] = [];
  constructor(private readonly matches: readonly AvailableInventoryMatch[]) {}

  async findAvailable(input: FindAvailableInventoryInput): Promise<readonly AvailableInventoryMatch[]> {
    this.calls.push(input);
    return this.matches;
  }
}

const validInput: FindAvailableInventoryInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  term: "ibuprofen",
};

describe("createInventoryDiscoveryStep", () => {
  it("searches using the input from the workflow context and returns the matches", async () => {
    const match: AvailableInventoryMatch = {
      inventoryId: "inv-1",
      medicineName: "Ibuprofen 200mg",
      pharmacyName: "MedLink Pharmacy",
      pharmacyLocality: "Lekki",
      stockStatus: "available",
    };
    const finder = new RecordingInventoryFinder([match]);
    const step = createInventoryDiscoveryStep(finder);

    const patch = await step.execute(baseInstance({ findAvailableInventoryInput: validInput }));

    expect(finder.calls).toEqual([validInput]);
    expect(patch).toEqual({ availableInventory: [match] });
  });

  it("accepts a null term (browse-all) as a valid input", async () => {
    const finder = new RecordingInventoryFinder([]);
    const step = createInventoryDiscoveryStep(finder);

    await step.execute(baseInstance({ findAvailableInventoryInput: { ...validInput, term: null } }));

    expect(finder.calls).toEqual([{ ...validInput, term: null }]);
  });

  it("skips the search and reports why rather than calling the finder with a missing input", async () => {
    const finder = new RecordingInventoryFinder([]);
    const step = createInventoryDiscoveryStep(finder);

    const patch = await step.execute(baseInstance({}));

    expect(finder.calls).toHaveLength(0);
    expect(patch).toEqual({ inventoryDiscoverySkippedReason: "missing_or_invalid_input" });
  });
});
