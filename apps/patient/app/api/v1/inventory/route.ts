import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runExperienceApi(request, "patient.inventory.search", {
  name: "inventory.discover",
  permission: "inventory:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).inventory(context.organizationId),
});
