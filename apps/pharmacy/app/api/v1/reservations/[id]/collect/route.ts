import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";
import { collectReservation, collectReservationSchema } from "../../../../../../lib/reservations";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// F3: ready -> collected, gated on the patient presenting the pickup
// credential F2 issued. No patient-side transaction is required or exists
// -- the pharmacy submits what the patient hands over.
export const POST = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "reservations.collect",
    permission: "reservation:manage",
    schema: z.object({ id: idSchema, decision: collectReservationSchema }),
    input: async (value) => ({ id, decision: await value.json() }),
    execute: (input, context, database) =>
      collectReservation(context, database, input.id, input.decision),
    success: (data) => Response.json({ data }),
  });
};
