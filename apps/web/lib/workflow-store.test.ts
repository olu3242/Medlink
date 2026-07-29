import { describe, expect, it } from "vitest";
import { toWorkflowInstance } from "./workflow-store";

describe("toWorkflowInstance", () => {
  it("maps a valid row to the packages/workflows WorkflowInstance shape", () => {
    const instance = toWorkflowInstance({
      id: "00000000-0000-4000-8000-000000000001",
      organization_id: "00000000-0000-4000-8000-000000000002",
      type: "medicine_search",
      status: "running",
      completed_steps: ["parse_query"],
      context: { term: "ibuprofen" },
    });

    expect(instance).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000002",
      type: "medicine_search",
      status: "running",
      completedSteps: ["parse_query"],
      context: { term: "ibuprofen" },
    });
  });

  it("throws rather than silently coercing an out-of-schema status", () => {
    expect(() =>
      toWorkflowInstance({
        id: "00000000-0000-4000-8000-000000000001",
        organization_id: "00000000-0000-4000-8000-000000000002",
        type: "medicine_search",
        status: "not-a-real-status",
        completed_steps: [],
        context: {},
      }),
    ).toThrow();
  });
});
