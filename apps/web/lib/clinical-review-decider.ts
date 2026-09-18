import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClinicalReviewDecider,
  DecideClinicalReviewInput,
  DecidedClinicalReview,
} from "@medlink/workflows";
import { RuntimeError } from "@medlink/runtime";

function infrastructureError(cause: unknown): RuntimeError {
  return new RuntimeError(
    "infrastructure",
    "database_operation_failed",
    "The data operation could not be completed",
    503,
    true,
    "Retry later.",
    { cause },
  );
}

// decide_clinical_review (migration 202607290017, self-review guard added in
// 202609180088) raises these as deliberate denials, not transient failures --
// mapping them to a generic retryable 503 would tell a denied caller to
// retry an operation that will never succeed, and would mask a real
// authorization decision as an infrastructure fault.
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

interface DecideClinicalReviewRpcRow {
  id: string;
  decision: string;
}

// Bridges packages/workflows' ClinicalReviewDecider port to the atomic
// decide_clinical_review RPC (migration 202607290017), the same "no HTTP
// request of its own" reasoning apps/web/lib/mar-creator.ts's
// SupabaseMarCreator documents: a workflow-invoked decision generates its
// own request id, uses the review id as a stable idempotency key (the RPC
// itself is what makes repeated calls with the same decision replay-safe,
// not this key), and tags the channel "workflow".
export class SupabaseClinicalReviewDecider implements ClinicalReviewDecider {
  constructor(private readonly database: SupabaseClient) {}

  async decide(input: DecideClinicalReviewInput): Promise<DecidedClinicalReview> {
    const { data, error } = await this.database.rpc("decide_clinical_review", {
      target_organization_id: input.organizationId,
      target_actor_id: input.actorId,
      target_correlation_id: `${input.reviewId}:decide`,
      target_request_id: randomUUID(),
      target_idempotency_key: `${input.reviewId}:decide`,
      target_channel: "workflow",
      target_review_id: input.reviewId,
      target_decision: input.decision,
      target_recommendation: input.recommendation,
    });
    if (error) throw decisionDeniedError(error.message ?? "") ?? infrastructureError(error);
    const row = data as DecideClinicalReviewRpcRow;
    return { id: row.id, decision: row.decision };
  }
}
