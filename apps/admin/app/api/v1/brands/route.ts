import { z } from "zod";
import { CatalogApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "catalog.brands.list",
  permission: "medicine:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, _context, database) =>
    new CatalogApplication(database).brands(),
});
