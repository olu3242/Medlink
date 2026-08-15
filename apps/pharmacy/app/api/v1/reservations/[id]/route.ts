import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";
import { decideReservation, reservationDecisionSchema } from "../../../../../lib/reservations";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// The database side of a route apps/pharmacy/app/reservations/page.tsx
// already ships and already calls (PATCH /api/v1/reservations/:id with
// {status}) -- this file is what makes that existing UI action real,
// not a new UI/API contract.
export const PATCH = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "reservations.decide",
    permission: "reservation:manage",
    schema: z.object({ id: idSchema, decision: reservationDecisionSchema }),
    input: async (value) => ({ id, decision: await value.json() }),
    execute: async (input, context, database) =>
      decideReservation(context, database, input.id, input.decision),
    success: (data) => Response.json({ data }),
  });
};
