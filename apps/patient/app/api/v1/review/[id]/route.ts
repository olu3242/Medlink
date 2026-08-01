import { z } from "zod";
import { AccessApplication } from "../../../../../lib/application";
import { runExperienceApi } from "../../../../../lib/api-server";
import { decisionSchema } from "./schema";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runExperienceApi(request, "pharmacist.review.get", {
    name: "clinical.reviews.get",
    permission: "clinical:review",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, context, database) =>
      new AccessApplication(database).review(context.organizationId, input.id),
  });
};

export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runExperienceApi(request, "pharmacist.review.decide", {
    name: "clinical.reviews.decide",
    permission: "clinical:review",
    schema: z.object({ id: idSchema, decision: decisionSchema }),
    input: async (value) => ({ id, decision: await value.json() }),
    execute: async (input, context, database) =>
      new AccessApplication(database).decideReview(context, input.id, input.decision),
  });
};
