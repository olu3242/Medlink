import { reservationDecisionSchema, requestIdempotencyKey } from "@medlink/api";
import { z } from "zod";
import { AccessApplication } from "../../../../../../lib/application";
import { runExperienceApi } from "../../../../../../lib/api-server";

type Context = { params: Promise<{ id: string }> };

export const PATCH = async (request: Request, route: Context) => {
  const id = z.string().uuid().parse((await route.params).id);
  return runExperienceApi(request, "pharmacy.reservation.decide", {
    name: "reservations.decide",
    permission: "reservation:manage",
    schema: z.object({ id: z.string().uuid(), command: reservationDecisionSchema }),
    input: async (value) => ({
      id,
      command: {
        ...await value.json() as object,
        idempotencyKey: requestIdempotencyKey(value),
      },
    }),
    execute: (input, context, database) =>
      new AccessApplication(database).decideReservation(
        context,
        input.command.idempotencyKey,
        input.id,
        input.command,
      ),
  });
};
