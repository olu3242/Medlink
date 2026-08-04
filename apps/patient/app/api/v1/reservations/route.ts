import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";
import { getNotificationEnvironment } from "../../../../lib/env";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase-service-role";
import { buildReservationNotificationDispatcher } from "../../../../lib/notification-outbox";

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

// G09 minimum slice (FINAL_GO_NO_GO.md): best-effort only. A patient's
// reservation has already committed by the time this runs -- a WhatsApp
// outage, missing credential, or notification-store failure here must
// never turn into a failed reservation response. The event this leaves
// unprocessed simply stays pending/retrying in runtime_outbox_events for
// the next reservation request to pick up (see
// buildReservationNotificationDispatcher's comment on why there is no
// scheduler in this environment).
async function dispatchPendingReservationNotifications(): Promise<void> {
  try {
    const { WHATSAPP_ACCESS_TOKEN } = getNotificationEnvironment();
    const database = createSupabaseServiceRoleClient();
    const dispatcher = buildReservationNotificationDispatcher(database, WHATSAPP_ACCESS_TOKEN);
    await dispatcher.dispatch("patient-reservations-worker", 5);
  } catch {
    // Swallowed deliberately -- see comment above.
  }
}

export const POST = async (request: Request) => {
  const response = await runApi(request, {
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
  if (response.status === 201) {
    await dispatchPendingReservationNotifications();
  }
  return response;
};
