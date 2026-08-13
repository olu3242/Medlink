import { createCatalogIngredientSchema } from "@medlink/medicine";
import { CatalogApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "catalog.ingredients.list",
  permission: "medicine:read",
  schema: createCatalogIngredientSchema.pick({}),
  input: async () => ({}),
  execute: async (_input, _context, database) =>
    new CatalogApplication(database).ingredients(),
});

export const POST = (request: Request) => runApi(request, {
  name: "catalog.ingredients.create",
  permission: "medicine:manage",
  schema: createCatalogIngredientSchema,
  input: (value) => value.json(),
  execute: async (value, context, database) =>
    new CatalogApplication(database).createIngredient({
      organizationId: context.organizationId,
      actorId: context.userId,
      value,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? context.requestId,
      correlationId: context.correlationId,
      requestId: context.requestId,
    }),
  success: (data) => Response.json({ data }, { status: 201 }),
});
