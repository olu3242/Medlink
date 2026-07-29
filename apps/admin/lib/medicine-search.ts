import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brandMedicineSchema,
  normalizeMedicineName,
  type BrandMedicine,
  type GenericMedicine,
} from "@medlink/medicine";
import {
  SearchUnavailableError,
  type MedicineSearchIndex,
  type SearchIndexHit,
  type SearchMedicineReader,
} from "@medlink/search";

// The medicines table has no dedicated search index yet (P1 item 10 in
// docs/audit/RC1_BACKLOG.md calls out "select/configure ... search
// adapter"); this backs MedicineSearchIndex with the pg_trgm indexes already
// defined on medicines.brand_name (migration 202607270002). It only ever
// returns "brand" hits: there is no first-class generic-medicine entity in
// the schema (medicines stores brand_name/generic_name as two text columns
// on one row, not as related brand/generic entities), so a "generic" search
// type is requested but never populated rather than faked.
export class TrigramMedicineSearchIndex implements MedicineSearchIndex {
  constructor(private readonly database: SupabaseClient) {}

  async search(input: {
    readonly normalizedTerm: string;
    readonly types: readonly ("brand" | "generic")[];
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<{ readonly hits: readonly SearchIndexHit[]; readonly nextCursor?: string }> {
    if (!input.types.includes("brand")) return { hits: [] };
    const escaped = input.normalizedTerm.replaceAll(",", "").replaceAll("%", "");
    const { data, error } = await this.database.from("medicines")
      .select("id")
      .eq("status", "active").is("deleted_at", null)
      .ilike("brand_name", `%${escaped}%`)
      .order("brand_name")
      .limit(input.limit);
    if (error) throw new SearchUnavailableError(error);
    return {
      hits: (data ?? []).map((row: { id: string }) => ({
        id: row.id,
        type: "brand" as const,
        score: 1,
        matchedOn: "name" as const,
      })),
    };
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
      const candidate = {
        id: row.id,
        brandName: row.brand_name,
        normalizedName: normalizeMedicineName(row.brand_name),
        manufacturer: row.manufacturer_name ?? "",
        ingredients: (row.medicine_ingredients ?? []).map(
          (ingredient: { active_ingredient_id: string; amount: string; unit: string }) => ({
            genericId: ingredient.active_ingredient_id,
            amount: Number(ingredient.amount),
            unit: ingredient.unit,
          }),
        ),
        dosageForm: row.dosage_form,
        route: row.route,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      // medicines stores dosage_form/route/manufacturer_name/ingredient unit
      // as free text, not the closed vocabularies packages/medicine models
      // (dosageForms/administrationRoutes/strengthUnits). A row outside
      // those vocabularies fails domain validation; skip it rather than
      // surface a broken search result or throw for the whole query.
      const parsed = brandMedicineSchema.safeParse(candidate);
      if (parsed.success) results.push(parsed.data);
    }
    return results;
  }

  async findGenericsByIds(): Promise<readonly GenericMedicine[]> {
    return [];
  }
}
