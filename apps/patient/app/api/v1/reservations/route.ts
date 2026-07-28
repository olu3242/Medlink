import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

const createSchema = z.object({
  marId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  inventoryBatchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
  expiresAt: z.string().datetime(),
});

export const GET = (request: Request) => runApi(request, {
  name: "reservations.list",
  permission: "reservation:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).reservations(context.organizationId),
});

export const POST = (request: Request) => runApi(request, {
  name: "reservations.create",
  permission: "reservation:create",
  schema: createSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) =>
    new AccessApplication(database).reserve(context.organizationId, input),
  success: (data) => Response.json({ data }, { status: 201 }),
});
