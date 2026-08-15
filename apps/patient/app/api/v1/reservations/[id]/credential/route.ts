import { z } from "zod";
import { AccessApplication } from "../../../../../../lib/application";
import { runExperienceApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// Patient-owned credential issuance: the plaintext pickup code is
// generated and hashed entirely in the browser (see
// apps/patient/lib/pickup-credential.ts) -- this route, like
// issue_pickup_credential itself, only ever receives/stores the SHA-256
// hash, and never dispatches a notification. The pickup code must never
// travel through WhatsApp or any other outbox-driven channel (see
// packages/notifications/src/reservation-outbox.ts).
export const POST = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runExperienceApi(request, "patient.reservation.credential", {
    name: "reservations.issue_credential",
    permission: "reservation:credential",
    schema: z.object({
      id: idSchema,
      pickupCodeHash: z.string().regex(/^[0-9a-f]{64}$/, "A valid pickup credential hash is required"),
    }),
    input: async (value) => ({ id, ...(await value.json()) }),
    execute: (input, context, database) =>
      new AccessApplication(database).issueCredential(context, input.id, input.pickupCodeHash),
    success: (data) => Response.json({ data }),
  });
};
