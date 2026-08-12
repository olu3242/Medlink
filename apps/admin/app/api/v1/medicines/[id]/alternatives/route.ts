import { z } from "zod";
import { CatalogApplication } from "../../../../../../lib/application";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
const alternativeSchema = z.object({
  alternativeMedicineId: idSchema,
  kind: z.enum(["pharmaceutical", "therapeutic"]),
  rationale: z.string().trim().min(3).max(2000),
  clinicalNotes: z.string().trim().min(1).max(4000).optional(),
}).strict();

type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const sourceMedicineId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.alternatives.list",
    permission: "medicine:read",
    schema: z.object({}),
    input: async () => ({}),
    execute: async (_input, _context, database) =>
      new CatalogApplication(database).equivalents(sourceMedicineId),
    success: (data) => Response.json({
      data,
      meta: {
        requiresPharmacistReview: true,
        mayAutoSubstitute: false,
      },
    }),
  });
};

export const POST = async (request: Request, route: Context) => {
  const sourceMedicineId = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.alternatives.create",
    permission: "medicine:manage",
    schema: alternativeSchema,
    input: (value) => value.json(),
    execute: async (input, context, database) =>
      new CatalogApplication(database).createAlternative({
        organizationId: context.organizationId,
        actorId: context.userId,
        sourceMedicineId,
        alternativeMedicineId: input.alternativeMedicineId,
        kind: input.kind,
        rationale: input.rationale,
        ...(input.clinicalNotes === undefined
          ? {}
          : { clinicalNotes: input.clinicalNotes }),
        idempotencyKey:
          request.headers.get("idempotency-key") ?? context.requestId,
        correlationId: context.correlationId,
        requestId: context.requestId,
      }),
    success: (data) => Response.json({ data }, { status: 201 }),
  });
};
