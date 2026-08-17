import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SearchUnavailableError,
  type MedicineSearchIndex,
  type SearchIndexHit,
  SupabaseSearchMedicineReader,
} from "@medlink/search";

// The medicines and generics tables have no dedicated search index yet (P1
// item 10 in docs/audit/RC1_BACKLOG.md calls out "select/configure ...
// search adapter"); this backs MedicineSearchIndex with the pg_trgm indexes
// already defined on medicines.brand_name (migration 202607270002) and
// generics.canonical_name (migration 202607290011).
export class TrigramMedicineSearchIndex implements MedicineSearchIndex {
  constructor(private readonly database: SupabaseClient) {}

  async search(input: {
    readonly normalizedTerm: string;
    readonly types: readonly ("brand" | "generic")[];
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<{ readonly hits: readonly SearchIndexHit[]; readonly nextCursor?: string }> {
    const escaped = input.normalizedTerm.replaceAll(",", "").replaceAll("%", "");
    const hits: SearchIndexHit[] = [];

    if (input.types.includes("brand")) {
      const { data, error } = await this.database.from("medicines")
        .select("id")
        .eq("status", "active").is("deleted_at", null)
        .ilike("brand_name", `%${escaped}%`)
        .order("brand_name")
        .limit(input.limit);
      if (error) throw new SearchUnavailableError(error);
      hits.push(...(data ?? []).map((row: { id: string }) => ({
        id: row.id,
        type: "brand" as const,
        score: 1,
        matchedOn: "name" as const,
      })));
    }

    if (input.types.includes("generic")) {
      const { data, error } = await this.database.from("generics")
        .select("id")
        .eq("status", "active").is("deleted_at", null)
        .ilike("canonical_name", `%${escaped}%`)
        .order("canonical_name")
        .limit(input.limit);
      if (error) throw new SearchUnavailableError(error);
      hits.push(...(data ?? []).map((row: { id: string }) => ({
        id: row.id,
        type: "generic" as const,
        score: 1,
        matchedOn: "name" as const,
      })));
    }

    // Each query above independently applies input.limit, so requesting
    // both types can produce up to 2x the caller's requested limit --
    // enforce the public contract's actual maximum on the combined set
    // rather than per source.
    return { hits: hits.slice(0, input.limit) };
  }
}

export { SupabaseSearchMedicineReader };
