import { z } from "zod";

// status must stay a subset of the review_status DB enum (migration
// 202607270002: pending/approved/rejected/needs_information), minus
// "pending" - a decision can't submit the not-yet-decided state. See
// route.contract.test.ts.
export const reviewSchema = z.object({
  status: z.enum(["approved", "rejected", "needs_information"]),
  rationale: z.string().trim().min(1).max(2000),
});
