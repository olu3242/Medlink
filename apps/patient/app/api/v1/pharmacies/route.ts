import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runExperienceApi(request, "patient.pharmacy.list", {
  name: "pharmacies.discover",
  permission: "inventory:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).pharmacies(context.organizationId),
});
