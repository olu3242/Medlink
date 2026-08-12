import { z } from "zod";
import { saveCatalogMedicineSchema } from "@medlink/medicine";
import { CatalogApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

const listSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "retired"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const GET = (request: Request) => runApi(request, {
  name: "catalog.medicines.list",
  permission: "medicine:read",
  schema: listSchema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      query: query.get("q") || undefined,
      status: query.get("status") || undefined,
      limit: query.get("limit") ?? 100,
    };
  },
  execute: async (input, _context, database) =>
    new CatalogApplication(database).list(input),
  success: ({ items, total }) => Response.json({ data: items, meta: { total } }),
});

export const POST = (request: Request) => runApi(request, {
  name: "catalog.medicines.create",
  permission: "medicine:manage",
  schema: saveCatalogMedicineSchema,
  input: (value) => value.json(),
  execute: async (value, context, database) =>
    new CatalogApplication(database).create({
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
