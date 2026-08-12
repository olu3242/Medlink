import type { SupabaseClient } from "@supabase/supabase-js";
import { SearchUnavailableError } from "./errors";
import type { MedicineSearchIndex } from "./ports";
import type { SearchEntityType, SearchIndexHit } from "./contracts";

type SearchRow = {
  entity_id: string;
  entity_type: SearchEntityType;
  relevance: number;
  matched_on:
    | "brand"
    | "generic"
    | "ingredient"
    | "manufacturer"
    | "registration"
    | "synonym";
};

function legacyMatchedOn(value: SearchRow["matched_on"]):
SearchIndexHit["matchedOn"] {
  if (value === "manufacturer") return "manufacturer";
  return "name";
}

export class SupabaseMedicineSearchIndex implements MedicineSearchIndex {
  constructor(private readonly database: SupabaseClient) {}

  async search(input: {
    normalizedTerm: string;
    types: readonly SearchEntityType[];
    limit: number;
    cursor?: string;
  }) {
    const offset = input.cursor === undefined ? 0 : Number(input.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new SearchUnavailableError(new Error("Invalid search cursor"));
    }
    const { data, error } = await this.database.rpc("search_medicines", {
      search_term: input.normalizedTerm,
      requested_types: input.types,
      result_limit: input.limit + 1,
      result_offset: offset,
    });
    if (error) throw new SearchUnavailableError(error);
    const rows = (data ?? []) as SearchRow[];
    const page = rows.slice(0, input.limit);
    return {
      hits: page.map((row) => ({
        id: row.entity_id,
        type: row.entity_type,
        score: row.relevance,
        matchedOn: legacyMatchedOn(row.matched_on),
      })),
      ...(rows.length > input.limit
        ? { nextCursor: String(offset + input.limit) }
        : {}),
    };
  }
}
