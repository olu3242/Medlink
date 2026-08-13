import { z } from "zod";
import { CatalogApplication } from "../../../../../../lib/application";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
const mergeSchema = z.object({
  targetMedicineId: idSchema,
  expectedSourceVersion: z.number().int().positive(),
  expectedTargetVersion: z.number().int().positive(),
  rationale: z.string().trim().min(10).max(2000),
}).strict();

type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, route: Context) => {
  const sourceMedicineId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.merge",
    permission: "medicine:manage",
    schema: mergeSchema,
    input: (value) => value.json(),
    execute: async (input, context, database) =>
      new CatalogApplication(database).merge({
        organizationId: context.organizationId,
        actorId: context.userId,
        sourceMedicineId,
        targetMedicineId: input.targetMedicineId,
        expectedSourceVersion: input.expectedSourceVersion,
        expectedTargetVersion: input.expectedTargetVersion,
        rationale: input.rationale,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? context.requestId,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
  });
};
