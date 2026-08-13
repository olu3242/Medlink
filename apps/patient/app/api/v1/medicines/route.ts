import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
} from "@medlink/medicine";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";

const listSchema = z.object({
  query: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = (request: Request) => runApi(request, {
  name: "patient.medicines.list",
  permission: "medicine:read",
  schema: listSchema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    return {
      query: query.get("q") || undefined,
      limit: query.get("limit") ?? 50,
    };
  },
  execute: async (input, _context, database) =>
    new CanonicalMedicineCatalog(
      new SupabaseCanonicalMedicineRepository(database),
    ).list({ ...input, status: "active" }),
  success: ({ items, total }) =>
    Response.json({ data: items, meta: { total } }),
});
