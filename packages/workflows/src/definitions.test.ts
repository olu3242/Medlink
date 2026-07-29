import { describe, expect, it } from "vitest";
import { canonicalWorkflows } from "./service";
import { workflowDefinitions } from "./definitions";

describe("workflowDefinitions", () => {
  it("defines a structural step sequence for all fifteen canonical workflows, matching their canonical names", () => {
    for (const [id, name] of canonicalWorkflows) {
      const definition = workflowDefinitions[id];
      expect(definition, `missing definition for ${id}`).toBeDefined();
      expect(definition.name).toBe(name);
      expect(definition.steps.length).toBeGreaterThan(0);
    }
  });

  it("gives every workflow a unique set of step names", () => {
    for (const definition of Object.values(workflowDefinitions)) {
      expect(new Set(definition.steps).size).toBe(definition.steps.length);
    }
  });
});
