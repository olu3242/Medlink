import { describe, expect, it } from "vitest";
import type { MedicineSearchQuery, MedicineSearchService, SearchPage } from "@medlink/search";
import type { WorkflowInstance } from "./service";
import { createMedicineSearchStep } from "./medicine-search";

function baseInstance(context: Record<string, unknown>): WorkflowInstance {
  return {
    id: "w",
    tenantId: "t",
    type: "medicine_search",
    status: "running",
    completedSteps: [],
    context,
  };
}

class RecordingSearchService implements MedicineSearchService {
  readonly calls: MedicineSearchQuery[] = [];
  constructor(private readonly page: SearchPage) {}

  async search(query: MedicineSearchQuery): Promise<SearchPage> {
    this.calls.push(query);
    return this.page;
  }
}

describe("createMedicineSearchStep", () => {
  it("searches using the term from the workflow context and returns the result page", async () => {
    const service = new RecordingSearchService({ matches: [] });
    const step = createMedicineSearchStep(service);

    const patch = await step.execute(baseInstance({ term: "ibuprofen" }));

    expect(service.calls).toEqual([{ term: "ibuprofen" }]);
    expect(patch).toEqual({ searchResults: { matches: [] } });
  });

  it("forwards optional types and limit from the context when present", async () => {
    const service = new RecordingSearchService({ matches: [] });
    const step = createMedicineSearchStep(service);

    await step.execute(baseInstance({ term: "ibuprofen", types: ["generic"], limit: 5 }));

    expect(service.calls).toEqual([{ term: "ibuprofen", types: ["generic"], limit: 5 }]);
  });

  it("skips the search and reports why rather than calling the service with an empty term", async () => {
    const service = new RecordingSearchService({ matches: [] });
    const step = createMedicineSearchStep(service);

    const patch = await step.execute(baseInstance({ term: "" }));

    expect(service.calls).toHaveLength(0);
    expect(patch).toEqual({ searchResults: { matches: [] }, searchSkippedReason: "empty_term" });
  });

  it("treats a missing term the same as an empty one", async () => {
    const service = new RecordingSearchService({ matches: [] });
    const step = createMedicineSearchStep(service);

    const patch = await step.execute(baseInstance({}));

    expect(service.calls).toHaveLength(0);
    expect(patch).toMatchObject({ searchSkippedReason: "empty_term" });
  });
});
