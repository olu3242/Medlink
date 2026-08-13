import { z } from "zod";
import { updateCatalogMedicineSchema } from "@medlink/medicine";
import { CatalogApplication } from "../../../../../lib/application";
import { runApi } from "../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.get",
    permission: "medicine:read",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, _context, database) =>
      new CatalogApplication(database).get(input.id),
  });
};

export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.update",
    permission: "medicine:manage",
    schema: z.object({ id: idSchema, value: updateCatalogMedicineSchema }),
    input: async (value) => ({ id, value: await value.json() }),
    execute: async (input, context, database) =>
      new CatalogApplication(database).update({
        organizationId: context.organizationId,
        actorId: context.userId,
        medicineId: input.id,
        value: input.value,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? context.requestId,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};
