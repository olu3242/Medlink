import { z } from "zod";
import { CatalogApplication } from "../../../../lib/application";
import { runApi } from "../../../../lib/api-server";

const searchSchema = z.object({
  term: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().regex(/^\d+$/).optional(),
});

export const GET = (request: Request) => runApi(request, {
  name: "catalog.search",
  permission: "medicine:read",
  schema: searchSchema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      term: query.get("q"),
      limit: query.get("limit") ?? 20,
      cursor: query.get("cursor") ?? undefined,
    };
  },
  execute: async (input, _context, database) =>
    new CatalogApplication(database).search(input),
});
