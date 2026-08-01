import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

const createSchema = z.object({
  prescriptionId: z.string().uuid().optional(),
  medicineId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const GET = (request: Request) => runExperienceApi(request, "patient.mar.list", {
  name: "mar.list",
  permission: "mar:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).listMars(context.organizationId),
});

export const POST = (request: Request) => runExperienceApi(request, "patient.mar.create", {
  name: "mar.create",
  permission: "mar:create",
  schema: createSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) =>
    new AccessApplication(database).createMar(
      context.organizationId,
      context.userId,
      input,
    ),
  success: (data) => Response.json({ data }, { status: 201 }),
});
