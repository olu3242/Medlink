import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
} from "@medlink/medicine";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";

const schema = z.object({ query: z.string().trim().min(2).max(100) });

export const GET = (request: Request) => runApi(request, {
  name: "clinical.medicines.search",
  permission: "medicine:read",
  schema,
  input: async (value) => ({
    query: new URL(value.url).searchParams.get("q"),
  }),
  execute: async (input, _context, database) =>
    new CanonicalMedicineCatalog(
      new SupabaseCanonicalMedicineRepository(database),
    ).search({ query: input.query, limit: 20, offset: 0 }),
  success: ({ matches }) => Response.json({
    data: matches.map(({ medicine, relevance, matchedOn }) => ({
      ...medicine,
      relevance,
      matchedOn,
    })),
  }),
});
