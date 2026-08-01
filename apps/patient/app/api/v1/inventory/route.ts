import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runExperienceApi(request, "patient.inventory.search", {
  name: "inventory.discover",
  permission: "inventory:read",
  schema: z.object({ q: z.string().trim().max(200).optional() }),
  input: async (value) => {
    const query = new URL(value.url).searchParams.get("q");
    return { q: query ?? undefined };
  },
  execute: async (input, context, database) =>
    new AccessApplication(database).inventory(context.organizationId, input.q),
});
