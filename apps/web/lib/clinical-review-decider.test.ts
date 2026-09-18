import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseClinicalReviewDecider } from "./clinical-review-decider";

function database(rpcResult: { data?: unknown; error?: { message: string } | null }): SupabaseClient {
  return { rpc: async () => rpcResult } as unknown as SupabaseClient;
}

const input = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  actorId: "22222222-2222-2222-2222-222222222222",
  reviewId: "33333333-3333-3333-3333-333333333333",
  decision: "approved" as const,
  recommendation: "Proceed as prescribed",
};

describe("SupabaseClinicalReviewDecider", () => {
  it("returns the decided review on success", async () => {
    const decider = new SupabaseClinicalReviewDecider(database({ data: { id: input.reviewId, decision: "approved" } }));
    await expect(decider.decide(input)).resolves.toEqual({ id: input.reviewId, decision: "approved" });
  });

  it("denies self-review with a 403 authorization error, not a retryable infrastructure error", async () => {
    const decider = new SupabaseClinicalReviewDecider(database({ error: { message: "Self-review is prohibited" } }));
    await expect(decider.decide(input)).rejects.toMatchObject({ status: 403, code: "clinical_review_self_review_denied", retryable: false });
  });

  it("denies an unauthorized (non-pharmacist) role with a 403", async () => {
    const decider = new SupabaseClinicalReviewDecider(database({ error: { message: "Only a licensed pharmacist may decide a clinical review" } }));
    await expect(decider.decide(input)).rejects.toMatchObject({ status: 403, code: "clinical_review_role_denied" });
  });

  it("denies an authenticated-actor mismatch with a 401", async () => {
    const decider = new SupabaseClinicalReviewDecider(database({ error: { message: "Authenticated actor mismatch" } }));
    await expect(decider.decide(input)).rejects.toMatchObject({ status: 401, code: "clinical_review_actor_mismatch" });
  });

  it("surfaces an already-decided conflict as a 409, not an infrastructure error", async () => {
    const decider = new SupabaseClinicalReviewDecider(database({ error: { message: "Clinical review has already been decided" } }));
    await expect(decider.decide(input)).rejects.toMatchObject({ status: 409, code: "clinical_review_already_decided" });
  });

  it("falls back to a retryable infrastructure error for an unrecognized database failure", async () => {
    const decider = new SupabaseClinicalReviewDecider(database({ error: { message: "connection reset" } }));
    await expect(decider.decide(input)).rejects.toMatchObject({ status: 503, code: "database_operation_failed", retryable: true });
  });
});
