import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";
import { markReservationReady } from "../../../../../../lib/reservations";
import { dispatchPendingReservationNotifications } from "../../../../../../lib/notification-dispatch";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// F2: confirmed -> ready. Generates and returns the pickup credential in
// plaintext exactly once, in this response -- see
// apps/pharmacy/lib/reservations.ts's markReservationReady for why a
// replay of this same call can never re-reveal it. The best-effort READY
// notification dispatched below never carries that plaintext -- see
// packages/notifications/src/reservation-outbox.ts's NOTIFICATION_TEMPLATES
// comment for why an async, durable-outbox-driven notification cannot
// safely deliver a one-time secret that is never persisted anywhere.
export const POST = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  const response = await runApi(request, {
    name: "reservations.ready",
    permission: "reservation:manage",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: (input, context, database) => markReservationReady(context, database, input.id),
    success: (data) => Response.json({ data }),
  });
  if (response.ok) {
    await dispatchPendingReservationNotifications();
  }
  return response;
};
