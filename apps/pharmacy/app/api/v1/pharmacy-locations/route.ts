import {
  PharmacyLocationDirectory,
  SupabasePharmacyLocationRepository,
} from "@medlink/pharmacy";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "pharmacy.locations.list",
  permission: "organization:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new PharmacyLocationDirectory(
      new SupabasePharmacyLocationRepository(database),
    ).listActive(context.organizationId),
});
