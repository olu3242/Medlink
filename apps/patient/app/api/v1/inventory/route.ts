import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "inventory.discover",
  permission: "inventory:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new AccessApplication(database).inventory(context.organizationId),
});
