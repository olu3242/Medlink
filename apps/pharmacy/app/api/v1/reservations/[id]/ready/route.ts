import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";
import { markReservationReady } from "../../../../../../lib/reservations";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// F2: confirmed -> ready. Generates and returns the pickup credential in
// plaintext exactly once, in this response -- see
// apps/pharmacy/lib/reservations.ts's markReservationReady for why a
// replay of this same call can never re-reveal it.
export const POST = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "reservations.ready",
    permission: "reservation:manage",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: (input, context, database) => markReservationReady(context, database, input.id),
    success: (data) => Response.json({ data }),
  });
};
