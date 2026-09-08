import { z } from "zod";
import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
} from "@medlink/medicine";
import { runApi } from "@medlink/api";

const listSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(["draft", "active", "retired"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const GET = (request: Request) => runApi(request, {
  name: "catalog.medicines.list",
  permission: "medicine:read",
  schema: listSchema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      query: query.get("q") || undefined,
      status: query.get("status") || undefined,
      limit: query.get("limit") ?? 100,
    };
  },
  execute: async (input, _context, database) =>
    new CanonicalMedicineCatalog(
      new SupabaseCanonicalMedicineRepository(database),
    ).list(input),
  success: ({ items, total }) => Response.json({ data: items, meta: { total } }),
});
