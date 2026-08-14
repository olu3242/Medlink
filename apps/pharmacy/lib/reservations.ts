import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import { z } from "zod";

// Same wrapper apps/patient/lib/application.ts's result() uses for every
// other decision RPC in this codebase (create_mar, decide_clinical_review,
// reserve_inventory): a thrown Postgres/RPC error becomes a safe,
// generic RuntimeError rather than a raw database error reaching the
// client. This does not differentiate error categories by HTTP status --
// consistent with every sibling RPC call already in the codebase, not a
// gap introduced here.
async function result<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
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

// External contract: the UI says "Decline"; the domain has no "declined"
// state, only "cancelled" (reservation_status already defines
// pending/confirmed/ready/collected/cancelled/expired). "declined" exists
// only as API vocabulary and is mapped to "cancelled" below -- it is never
// persisted or added to the database enum.
export const reservationDecisionSchema = z.object({
  status: z.enum(["confirmed", "declined"]),
  reason: z.string().trim().min(1).optional(),
}).refine(
  (value) => value.status !== "declined" || (value.reason?.trim().length ?? 0) >= 3,
  { message: "A reason of at least 3 characters is required to decline a reservation", path: ["reason"] },
);

export type ReservationDecisionInput = z.infer<typeof reservationDecisionSchema>;

export async function decideReservation(
  context: RuntimeContext,
  database: SupabaseClient,
  reservationId: string,
  input: ReservationDecisionInput,
) {
  const targetStatus = input.status === "declined" ? "cancelled" : "confirmed";
  // Confirm's reason is optional -- never synthesized when absent (the
  // RPC itself receives null, not a placeholder string). Decline's reason
  // is validated here too, ahead of the RPC's own check, so a missing
  // reason on decline surfaces as an ordinary 400 validation error through
  // the ApiOperation schema rather than only as an RPC exception.
  if (targetStatus === "cancelled" && !input.reason) {
    throw new RuntimeError(
      "validation",
      "reason_required",
      "A reason is required to decline a reservation",
      400,
      false,
      "Provide a reason and retry.",
    );
  }
  return result(database.rpc("decide_reservation", {
    target_organization_id: context.organizationId,
    target_actor_id: context.userId,
    target_correlation_id: context.correlationId,
    target_request_id: context.requestId,
    target_idempotency_key: `${reservationId}:${targetStatus}`,
    target_channel: context.channel,
    target_reservation_id: reservationId,
    target_status: targetStatus,
    target_reason: input.reason ?? null,
  }));
}
