import { z } from "zod";
import { CatalogApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

const schema = z.object({ medicineId: z.string().uuid() });

export const GET = (request: Request) => runApi(request, {
  name: "catalog.equivalents.list",
  permission: "medicine:read",
  schema,
  input: async (value) => ({
    medicineId: new URL(value.url).searchParams.get("medicineId"),
  }),
  execute: async (input, _context, database) =>
    new CatalogApplication(database).equivalents(input.medicineId),
  success: (data) => Response.json({
    data,
    meta: {
      requiresPharmacistReview: true,
      mayAutoSubstitute: false,
      warning: "Alternatives require an independent pharmacist decision.",
    },
  }),
});
