import { describe, expect, it } from "vitest";
import { decideRelease } from "./release-decision";

describe("final release decision", () => {
  it("stays conditional while external evidence or approvals are pending", () => {
    expect(decideRelease([
      { id: "source", passed: true, conditional: false, evidence: ["tests"] },
      { id: "providers", passed: false, conditional: true, evidence: [] },
      { id: "approvals", passed: false, conditional: true, evidence: [] },
    ])).toEqual({
      status: "conditional",
      failed: [],
      conditional: ["providers", "approvals"],
    });
  });

  it("rejects a failed mandatory control", () => {
    expect(decideRelease([
      { id: "tenant-rls", passed: false, conditional: false, evidence: [] },
    ])).toMatchObject({ status: "rejected", failed: ["tenant-rls"] });
  });
});
