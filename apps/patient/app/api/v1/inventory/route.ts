import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

const schema = z.object({
  q: z.string().trim().max(200).optional(),
  medicineId: z.string().uuid().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).default(25),
  locationConsent: z.literal("true").optional(),
});

export const GET = (request: Request) => runExperienceApi(request, "patient.inventory.search", {
  name: "inventory.discover",
  permission: "inventory:read",
  schema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return Object.fromEntries(query.entries());
  },
  execute: async (input, context, database) => {
    const application = new AccessApplication(database);
    if (input.medicineId && input.latitude !== undefined && input.longitude !== undefined) {
      return application.eligiblePharmacies({
        organizationId: context.organizationId, medicineId: input.medicineId,
        latitude: input.latitude, longitude: input.longitude,
        radiusKm: input.radiusKm ?? 25, locationConsent: input.locationConsent === "true",
      });
    }
    return application.inventory(context.organizationId, input.q);
  },
});
