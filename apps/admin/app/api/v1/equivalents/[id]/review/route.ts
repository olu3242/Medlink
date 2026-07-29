import { z } from "zod";
import { CatalogApplication } from "../../../../../../lib/application";
import { runApi } from "../../../../../../lib/api-server";
import { reviewSchema } from "./schema";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.equivalents.review",
    permission: "clinical:review",
    schema: z.object({ id: idSchema, review: reviewSchema }),
    input: async (value) => ({ id, review: await value.json() }),
    execute: async (input, context, database) =>
      new CatalogApplication(database).reviewEquivalence(
        context,
        request.headers.get("idempotency-key") ?? context.requestId,
        input.id,
        input.review,
      ),
  });
};
