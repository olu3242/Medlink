import { z } from "zod";
import { PrescriptionApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

const createSchema = z.object({
  patientId: z.string().uuid(),
  source: z.enum(["upload", "electronic"]),
  storageBucket: z.string().min(1).max(100).optional(),
  storageObjectPath: z.string().min(1).max(1000).optional(),
  externalReference: z.string().max(200).optional(),
}).refine((value) => value.source === "electronic"
  ? Boolean(value.externalReference)
  : Boolean(value.storageBucket && value.storageObjectPath));

export const GET = (request: Request) => runApi(request, {
  name: "prescriptions.list",
  permission: "prescription:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new PrescriptionApplication(database).list(context.organizationId),
});

export const POST = (request: Request) => runApi(request, {
  name: "prescriptions.create",
  permission: "prescription:create",
  schema: createSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) =>
    new PrescriptionApplication(database).create(
      context,
      request.headers.get("idempotency-key") ?? context.requestId,
      input,
    ),
  success: (data) => Response.json({ data }, { status: 201 }),
});
