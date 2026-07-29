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
    if (error) throw infrastructureError(error);
    const row = data as DecideClinicalReviewRpcRow;
    return { id: row.id, decision: row.decision };
  }
}
