import { z } from "zod";
import { runApi } from "@medlink/api";

import { CatalogApplication } from "../../../../lib/admin/application";

const schema = z.object({ q: z.string() });

export const GET = (request: Request) => runApi(request, {
  name: "search.global",
  permission: "medicine:read",
  schema,
  input: async (value) => ({ q: new URL(value.url).searchParams.get("q") ?? "" }),
  execute: async (input, _context, database) => {
    const query = input.q.trim();
    if (query.length < 2) return { medicines: [] };

    const { matches } = await new CatalogApplication(database).search({ term: query, limit: 6 });
    return {
      medicines: matches.map(({ medicine, matchedOn }) => ({
        id: medicine.id,
        brandName: medicine.brandName,
        genericName: medicine.genericName,
        strength: medicine.strength,
        dosageForm: medicine.dosageForm,
        matchedOn,
      })),
    };
  },
  success: (output) => Response.json({ data: output }, { headers: { "Cache-Control": "private, no-store" } }),
});
