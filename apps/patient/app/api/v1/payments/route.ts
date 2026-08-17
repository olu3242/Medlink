import { z } from "zod";
import { runExperienceApi } from "../../../../lib/api-server";
import { createPatientPaymentAttempt, listPatientPayments } from "../../../../lib/payments";

const createSchema = z.object({
  reservationId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const GET = (request: Request) => runExperienceApi(request, "patient.payment.list", {
  name: "payments.list",
  permission: "payment:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) => listPatientPayments(database, context),
});

export const POST = (request: Request) => runExperienceApi(request, "patient.payment.create", {
  name: "payments.create",
  permission: "payment:create",
  schema: createSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) =>
    createPatientPaymentAttempt(database, context, input),
  success: (data) => Response.json({ data }, { status: 201 }),
});
