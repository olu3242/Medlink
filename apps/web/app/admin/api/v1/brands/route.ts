import { z } from "zod";
import { CatalogApplication } from "../../../../../lib/admin/application";
import { runApi } from "../../../../../lib/admin/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "catalog.brands.list",
  permission: "medicine:read",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, _context, database) =>
    new CatalogApplication(database).brands(),
});
