import { describe, expect, it } from "vitest";
import { canonicalWorkflows } from "./service";

describe("canonical workflow contract", () => {
  it("preserves all fifteen stable workflow identities", () => {
    expect(canonicalWorkflows).toHaveLength(15);
    expect(new Set(canonicalWorkflows.map(([id]) => id)).size).toBe(15);
    expect(Object.fromEntries(canonicalWorkflows)).toMatchObject({
      "WF-006": "Medication Access Request",
      "WF-015": "Workflow Completion",
    });
  });
});
