import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function prescriptionReviewAgentContext(
  database: SupabaseClient,
  organizationId: string,
  reviewId: string,
): Promise<{ prescriptionId: string; workflowId?: string }> {
  const { data, error } = await database.from("clinical_validations")
    .select("prescription_id,workflow_run_id")
    .eq("organization_id", organizationId)
    .eq("id", reviewId)
    .single();
  if (error || !data) throw new RuntimeError(
    "infrastructure",
    "clinical_review_context_unavailable",
    "The clinical review context could not be loaded",
    503,
    true,
    "Retry later.",
    { cause: error },
  );
  return {
    prescriptionId: data.prescription_id,
    ...(data.workflow_run_id ? { workflowId: data.workflow_run_id } : {}),
  };
}
