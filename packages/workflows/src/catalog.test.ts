import { describe, expect, it } from "vitest";
import { canonicalWorkflows } from "./service";

describe("canonical workflow contract", () => {
  it("preserves all sixteen stable workflow identities", () => {
    expect(canonicalWorkflows).toHaveLength(16);
    expect(new Set(canonicalWorkflows.map(([id]) => id)).size).toBe(16);
    expect(Object.fromEntries(canonicalWorkflows)).toMatchObject({
      "WF-006": "Medication Access Request",
      "WF-015": "Workflow Completion",
      "WF-016": "Partner Onboarding",
    });
  });

  it.each(canonicalWorkflows)("%s %s resumes and completes idempotently", async (id) => {
    const { WorkflowService } = await import("./service");
    let completedSteps: readonly string[] = [];
    const service = new WorkflowService({
      findByKey: async () => null,
      create: async () => ({
        id,
        tenantId: "tenant-1",
        type: id,
        status: "running",
        completedSteps,
        context: {},
      }),
      markStep: async (_instanceId, step) => {
        completedSteps = [...completedSteps, step];
        return {
          id,
          tenantId: "tenant-1",
          type: id,
          status: "running",
          completedSteps,
          context: {},
        };
      },
      complete: async () => ({
        id,
        tenantId: "tenant-1",
        type: id,
        status: "completed",
        completedSteps,
        context: {},
      }),
    });
    const execute = async () => undefined;
    const result = await service.run({
      tenantId: "tenant-1",
      type: id,
      idempotencyKey: `key-${id}`,
      steps: [{ name: "execute", execute }],
    });
    expect(result).toMatchObject({ type: id, status: "completed" });
    expect(result.completedSteps).toEqual(["execute"]);
  });
});
