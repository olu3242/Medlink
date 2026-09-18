import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeContext } from "@medlink/runtime";
import { AccessReviewApplication } from "./access-review-application";

function database(rpcResult: { data?: unknown; error?: { message: string } | null }): SupabaseClient {
  return { rpc: async () => rpcResult } as unknown as SupabaseClient;
}

const context: RuntimeContext = {
  correlationId: "11111111-1111-1111-1111-111111111111",
  requestId: "req-1",
  tenantId: "22222222-2222-2222-2222-222222222222",
  organizationId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
  role: "pharmacist",
  locale: "en-NG",
  timezone: "Africa/Lagos",
  channel: "web",
  apiVersion: "v1",
};
const reviewId = "44444444-4444-4444-4444-444444444444";

describe("AccessReviewApplication.decide", () => {
  it("returns the decided review on success", async () => {
    const application = new AccessReviewApplication(database({ data: { id: reviewId, decision: "approved" } }));
    await expect(application.decide(context, reviewId, "approved", "Approved")).resolves.toEqual({
      id: reviewId, decision: "approved",
    });
  });

  it("denies self-review with a 403, not a retryable infrastructure error", async () => {
    const application = new AccessReviewApplication(database({ error: { message: "Self-review is prohibited" } }));
    await expect(application.decide(context, reviewId, "approved", "Approved")).rejects.toMatchObject({
      status: 403, code: "clinical_review_self_review_denied", retryable: false,
    });
  });

  it("denies an unauthorized (non-pharmacist) role with a 403", async () => {
    const application = new AccessReviewApplication(database({
      error: { message: "Only a licensed pharmacist may decide a clinical review" },
    }));
    await expect(application.decide(context, reviewId, "approved", "Approved")).rejects.toMatchObject({
      status: 403, code: "clinical_review_role_denied",
    });
  });

  it("denies an authenticated-actor mismatch with a 401", async () => {
    const application = new AccessReviewApplication(database({ error: { message: "Authenticated actor mismatch" } }));
    await expect(application.decide(context, reviewId, "approved", "Approved")).rejects.toMatchObject({
      status: 401, code: "clinical_review_actor_mismatch",
    });
  });

  it("surfaces an already-decided conflict as a 409, not an infrastructure error", async () => {
    const application = new AccessReviewApplication(database({
      error: { message: "Clinical review has already been decided" },
    }));
    await expect(application.decide(context, reviewId, "approved", "Approved")).rejects.toMatchObject({
      status: 409, code: "clinical_review_already_decided",
    });
  });

  it("falls back to a retryable infrastructure error for an unrecognized database failure", async () => {
    const application = new AccessReviewApplication(database({ error: { message: "connection reset" } }));
    await expect(application.decide(context, reviewId, "approved", "Approved")).rejects.toMatchObject({
      status: 503, code: "database_operation_failed", retryable: true,
    });
  });
});
