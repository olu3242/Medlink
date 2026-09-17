import { describe, expect, it } from "vitest";
import { reviewSchema } from "./schema";

// Locks the equivalency review contract to the tenant_equivalence_reviews'
// review_status DB enum (migration 202607270002:
// pending/approved/rejected/needs_information, minus "pending").
describe("PATCH /api/v1/equivalents/{id}/review contract", () => {
  it.each(["approved", "rejected", "needs_information"])(
    "accepts status %s with a rationale",
    (status) => {
      const result = reviewSchema.safeParse({ status, rationale: "Clinically appropriate." });
      expect(result.success).toBe(true);
    },
  );

  it("rejects the not-yet-decided 'pending' state as a submitted decision", () => {
    expect(reviewSchema.safeParse({ status: "pending", rationale: "x" }).success).toBe(false);
  });

  it("rejects a value the review_status enum has never had", () => {
    expect(reviewSchema.safeParse({ status: "changes_requested", rationale: "x" }).success)
      .toBe(false);
  });

  it("requires a non-empty rationale", () => {
    expect(reviewSchema.safeParse({ status: "approved", rationale: "" }).success).toBe(false);
  });
});
