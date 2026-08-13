import {
  PharmacistReviewNotFoundError,
  PharmacistReviewService,
  SupabasePharmacistReviewRepository,
} from "@medlink/clinical";
import { RuntimeError } from "@medlink/runtime";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";

const idSchema = z.string().uuid();
const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_information"]),
  rationale: z.string().min(3).max(4_000),
  acknowledgedFindingIds: z.array(z.string().uuid()).max(100).default([]),
  reviewedItems: z.array(z.object({
    prescriptionItemId: z.string().uuid(),
    medicineId: z.string().uuid(),
  }).strict()).max(100).default([]),
});
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "clinical.reviews.get",
    permission: "clinical:review",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, context, database) => {
      try {
        return await new PharmacistReviewService(
          new SupabasePharmacistReviewRepository(database),
        ).get(context.organizationId, input.id);
      } catch (error) {
        if (error instanceof PharmacistReviewNotFoundError) {
          throw new RuntimeError(
            "business_rule",
            error.code,
            error.message,
            404,
          );
        }
        throw error;
      }
    },
  });
};

export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "clinical.reviews.decide",
    permission: "clinical:review",
    schema: z.object({ id: idSchema, decision: decisionSchema }),
    input: async (value) => ({ id, decision: await value.json() }),
    execute: async (input, context, database) =>
      new PharmacistReviewService(
        new SupabasePharmacistReviewRepository(database),
      ).decide({
        tenantId: context.organizationId,
        reviewId: input.id,
        pharmacistId: context.userId,
        decision: input.decision.decision,
        rationale: input.decision.rationale,
        acknowledgedFindingIds:
          input.decision.acknowledgedFindingIds ?? [],
        reviewedItems: input.decision.reviewedItems ?? [],
        idempotencyKey: request.headers.get("idempotency-key")
          ?? context.requestId,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};
