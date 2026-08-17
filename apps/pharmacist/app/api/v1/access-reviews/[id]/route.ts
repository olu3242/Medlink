import { z } from "zod";
import { AccessReviewApplication } from "../../../../../lib/access-review-application";
import { runApi } from "../../../../../lib/api-server";

const idSchema = z.string().uuid();
const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_information"]),
  recommendation: z.string().trim().min(3).max(4_000),
});
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "clinical.access-reviews.get",
    permission: "clinical:review",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: (input, context, database) =>
      new AccessReviewApplication(database).get(context.organizationId, input.id),
  });
};

export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "clinical.access-reviews.decide",
    permission: "clinical:review",
    schema: z.object({ id: idSchema, body: decisionSchema }),
    input: async (value) => ({ id, body: await value.json() }),
    execute: (input, context, database) =>
      new AccessReviewApplication(database).decide(
        context,
        input.id,
        input.body.decision,
        input.body.recommendation,
      ),
  });
};
