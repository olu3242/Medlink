import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";

async function result<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) {
    throw new RuntimeError(
      "infrastructure",
      "database_operation_failed",
      "The data operation could not be completed",
      503,
      true,
      "Retry later.",
      { cause: error },
    );
  }
  return data;
}

// decide_clinical_review (migration 202607290017, self-review guard added in
// 202609180088) raises these as deliberate denials, not transient failures --
// mapping them through result()'s generic retryable 503 would tell a denied
// caller to retry an operation that will never succeed, and would mask a
// real authorization decision as an infrastructure fault. Same mapping as
// apps/web/lib/clinical-review-decider.ts's SupabaseClinicalReviewDecider,
// which wraps the same RPC for the packages/workflows orchestrator path;
// this is the separate application class the browser-facing
// /api/v1/access-reviews/[id] route actually calls.
function decisionDeniedError(message: string): RuntimeError | null {
  if (/self-review is prohibited/i.test(message)) {
    return new RuntimeError("authorization", "clinical_review_self_review_denied", "You cannot decide a clinical review for a request you created", 403);
  }
  if (/only a licensed pharmacist may decide/i.test(message)) {
    return new RuntimeError("authorization", "clinical_review_role_denied", "Only a licensed pharmacist may decide a clinical review", 403);
  }
  if (/authenticated actor mismatch/i.test(message)) {
    return new RuntimeError("authentication", "clinical_review_actor_mismatch", "Authentication mismatch", 401);
  }
  if (/clinical review has already been decided/i.test(message)) {
    return new RuntimeError("business_rule", "clinical_review_already_decided", "This clinical review has already been decided", 409);
  }
  return null;
}

async function decideResult<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) {
    throw decisionDeniedError(error.message ?? "") ?? new RuntimeError(
      "infrastructure",
      "database_operation_failed",
      "The data operation could not be completed",
      503,
      true,
      "Retry later.",
      { cause: error },
    );
  }
  return data;
}

export interface AccessReviewDetail {
  id: string;
  decision: string;
  recommendation: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  marId: string;
  marState: string;
  patientId: string;
  medicineId: string;
  medicineName: string;
}

export class AccessReviewApplication {
  constructor(private readonly database: SupabaseClient) {}

  async validateMar(context: RuntimeContext, marId: string) {
    await result(this.database.rpc("validate_mar", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: `${marId}:validate`,
      target_channel: context.channel,
      target_mar_id: marId,
    }));
    const review = await result(this.database.from("clinical_reviews")
      .select("id,mar_id,decision")
      .eq("organization_id", context.organizationId)
      .eq("mar_id", marId)
      .eq("decision", "pending")
      .single());
    return review as { id: string; mar_id: string; decision: string };
  }

  async get(organizationId: string, id: string): Promise<AccessReviewDetail> {
    const review = await result(this.database.from("clinical_reviews")
      .select("id,decision,recommendation,reviewed_by,reviewed_at,mar_id")
      .eq("organization_id", organizationId).eq("id", id).single());
    const row = review as {
      id: string; decision: string; recommendation: string | null;
      reviewed_by: string | null; reviewed_at: string | null; mar_id: string;
    };
    const mar = await result(this.database.from("medication_access_requests")
      .select("id,state,patient_id,requested_medicine_id,medicine:medicines(brand_name,generic_name)")
      .eq("organization_id", organizationId).eq("id", row.mar_id).single());
    const request = mar as unknown as {
      id: string; state: string; patient_id: string; requested_medicine_id: string;
      medicine?: { brand_name: string; generic_name: string } | null;
    };
    return {
      id: row.id,
      decision: row.decision,
      recommendation: row.recommendation,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      marId: request.id,
      marState: request.state,
      patientId: request.patient_id,
      medicineId: request.requested_medicine_id,
      medicineName: request.medicine?.brand_name || request.medicine?.generic_name || "Requested medicine",
    };
  }

  async decide(
    context: RuntimeContext,
    id: string,
    decision: "approved" | "rejected" | "needs_information",
    recommendation: string,
  ) {
    return decideResult(this.database.rpc("decide_clinical_review", {
      target_organization_id: context.organizationId,
      target_actor_id: context.userId,
      target_correlation_id: context.correlationId,
      target_request_id: context.requestId,
      target_idempotency_key: `${id}:decide`,
      target_channel: context.channel,
      target_review_id: id,
      target_decision: decision,
      target_recommendation: recommendation,
    }));
  }
}
