import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandMedicine, GenericMedicine } from "@medlink/medicine";
import {
  SearchUnavailableError,
  type MedicineSearchIndex,
  type SearchIndexHit,
  type SearchMedicineReader,
} from "@medlink/search";
import { toBrandMedicine, toGenericMedicine } from "./medicine-repository";

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

    return { hits };
  }
}

export class SupabaseSearchMedicineReader implements SearchMedicineReader {
  constructor(private readonly database: SupabaseClient) {}

  async findBrandsByIds(ids: readonly string[]): Promise<readonly BrandMedicine[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.database.from("medicines")
      .select("*, medicine_ingredients(active_ingredient_id, amount, unit)")
      .in("id", ids).is("deleted_at", null);
    if (error) throw new SearchUnavailableError(error);
    const results: BrandMedicine[] = [];
    for (const row of data ?? []) {
      const medicine = toBrandMedicine(row);
      if (medicine) results.push(medicine);
    }
    return results;
  }

  async findGenericsByIds(ids: readonly string[]): Promise<readonly GenericMedicine[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.database.from("generics")
      .select("*, therapeutic_classes(name)")
      .in("id", ids).is("deleted_at", null);
    if (error) throw new SearchUnavailableError(error);
    const results: GenericMedicine[] = [];
    for (const row of data ?? []) {
      const generic = toGenericMedicine(row);
      if (generic) results.push(generic);
    }
    return results;
  }
}
