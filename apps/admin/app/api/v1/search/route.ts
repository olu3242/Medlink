import { IndexedMedicineSearchService } from "@medlink/search";
import {
  SupabaseSearchMedicineReader,
  TrigramMedicineSearchIndex,
} from "../../../../lib/medicine-search";
import { runApi } from "../../../../lib/api-server";
import { schema } from "./schema";

export const GET = (request: Request) => runApi(request, {
  name: "catalog.search",
  permission: "medicine:read",
  schema,
  input: async (value) => {
    const query = new URL(value.url).searchParams;
    const types = query.getAll("types");
    const limit = query.get("limit");
    const cursor = query.get("cursor");
    return {
      term: query.get("term") ?? "",
      ...(types.length > 0 ? { types } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(cursor ? { cursor } : {}),
    };
  },
  execute: async (input, _context, database) =>
    new IndexedMedicineSearchService(
      new TrigramMedicineSearchIndex(database),
      new SupabaseSearchMedicineReader(database),
    ).search({
      term: input.term,
      ...(input.types === undefined ? {} : { types: input.types }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
});
