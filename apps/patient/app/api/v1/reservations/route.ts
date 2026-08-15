import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";
import { dispatchPendingReservationNotifications } from "../../../../lib/notification-dispatch";

const createSchema = z.object({
  marId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  inventoryBatchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
  expiresAt: z.string().datetime(),
});

export const GET = (request: Request) => runExperienceApi(request, "patient.reservation.list", {
  name: "reservations.list",
  permission: "reservation:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).reservations(context.organizationId),
});

export const POST = async (request: Request) => {
  const response = await runExperienceApi(request, "patient.reservation.create", {
    name: "reservations.create",
    permission: "reservation:create",
    schema: createSchema,
    input: (value) => value.json(),
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
  // G09 minimum slice: fire-and-forget, never gates the response above.
  if (response.status === 201) {
    await dispatchPendingReservationNotifications();
  }
  return response;
};
