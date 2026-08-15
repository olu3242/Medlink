import { runApi } from "../../../../lib/api-server";
import { listReservations, reservationListQuerySchema } from "../../../../lib/reservations";

// F1: the inbox apps/pharmacy/app/reservations/page.tsx already fetches
// from on mount. Backing route was previously entirely absent.
export const GET = (request: Request) => runApi(request, {
  name: "reservations.list",
  permission: "reservation:read",
  schema: reservationListQuerySchema,
  input: async (value) => Object.fromEntries(new URL(value.url).searchParams),
  execute: (input, context, database) => listReservations(context, database, input),
});
