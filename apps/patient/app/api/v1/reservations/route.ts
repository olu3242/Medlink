import { z } from "zod";
import { createReservationCommandSchema, requestIdempotencyKey } from "@medlink/api";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runExperienceApi(request, "patient.reservation.list", {
  name: "reservations.list",
  permission: "reservation:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).reservations(context.organizationId),
});

export const POST = (request: Request) => runExperienceApi(request, "patient.reservation.create", {
  name: "reservations.create",
  permission: "reservation:create",
  schema: createReservationCommandSchema,
  input: async (value) => ({
    ...await value.json() as object,
    idempotencyKey: requestIdempotencyKey(value),
  }),
  execute: async (input, context, database) =>
    new AccessApplication(database).reserve(context, input.idempotencyKey, {
      marId: input.marId,
      pharmacyLocationId: input.pharmacyLocationId,
      inventoryBatchId: input.inventoryBatchId,
      quantity: input.quantity,
      expiresAt: input.expiresAt,
    }),
  success: (data) => Response.json({ data }, { status: 201 }),
});
