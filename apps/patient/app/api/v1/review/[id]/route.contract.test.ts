import { describe, expect, it } from "vitest";
import { decisionSchema } from "./schema";

// Locks the clinical review decision contract to clinical_reviews' actual
// clinical_review_decision DB enum (migration 202607270003:
// pending/approved/rejected/needs_information, minus "pending"). This is a
// regression test for a real bug: the schema used to accept
// "changes_requested", a value that enum has never had - see
// docs/audit/RC1_SPRINT_REPORT.md Sprint 3.
describe("PATCH /api/v1/review/{id} contract", () => {
  it.each(["approved", "rejected", "needs_information"])(
    "accepts decision %s with a recommendation",
    (decision) => {
      const result = decisionSchema.safeParse({
        decision,
        recommendation: "Reviewed against current prescription.",
      });
      expect(result.success).toBe(true);
    },
  );

  it("rejects 'changes_requested', which clinical_review_decision has never had", () => {
    expect(
      decisionSchema.safeParse({ decision: "changes_requested", recommendation: "x".repeat(5) })
        .success,
    ).toBe(false);
  });

  it("rejects the not-yet-decided 'pending' state as a submitted decision", () => {
    expect(
      decisionSchema.safeParse({ decision: "pending", recommendation: "x".repeat(5) }).success,
    ).toBe(false);
  });

  it("requires a recommendation of at least 3 characters", () => {
    expect(decisionSchema.safeParse({ decision: "approved", recommendation: "ok" }).success)
      .toBe(false);
  });
});
