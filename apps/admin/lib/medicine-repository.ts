import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toBrandMedicine,
  toGenericMedicine,
  type GenericMedicineRow,
  type MedicineWithIngredientsRow,
  type BrandMedicine,
  type GenericMedicine,
  type MedicineCatalogReader,
} from "@medlink/medicine";
import { RuntimeError } from "@medlink/runtime";

export { toBrandMedicine, toGenericMedicine } from "@medlink/medicine";


const MEDICINE_WITH_INGREDIENTS_SELECT =
  "*, medicine_ingredients(active_ingredient_id, amount, unit)";

const GENERIC_SELECT = "*, therapeutic_classes(name)";

// Backs packages/medicine's MedicineCatalogReader port, the read side
// CatalogEquivalencyService.propose() needs to find ingredient-matching
// brand medicines. findGenericById reads the first-class public.generics
// table added in migration 202607290011 (see docs/wave-2-certification.md
// "known gaps" for the resolution history) -- it is a different entity from
// active_ingredients, which remains the ingredient-composition source
// findBrandsByIngredientIds below uses for equivalency.
export class SupabaseMedicineCatalogReader implements MedicineCatalogReader {
  constructor(private readonly database: SupabaseClient) {}

  async findBrandById(id: string): Promise<BrandMedicine | null> {
    const { data, error } = await this.database.from("medicines")
      .select(MEDICINE_WITH_INGREDIENTS_SELECT)
      .eq("id", id).is("deleted_at", null)
      .maybeSingle<MedicineWithIngredientsRow>();
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "database_operation_failed",
        "The data operation could not be completed",
        503,
        true,
        "Retry later.",
        { cause: error },
      );
    }
    return data ? toBrandMedicine(data) : null;
  }

  async findGenericById(id: string): Promise<GenericMedicine | null> {
    const { data, error } = await this.database.from("generics")
      .select(GENERIC_SELECT)
      .eq("id", id).is("deleted_at", null)
      .maybeSingle<GenericMedicineRow>();
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "database_operation_failed",
        "The data operation could not be completed",
        503,
        true,
        "Retry later.",
        { cause: error },
      );
    }
    return data ? toGenericMedicine(data) : null;
  }

  async findBrandsByIngredientIds(
    genericIds: readonly string[],
  ): Promise<readonly BrandMedicine[]> {
    if (genericIds.length === 0) return [];
    const { data: links, error: linksError } = await this.database
      .from("medicine_ingredients")
      .select("medicine_id")
      .in("active_ingredient_id", genericIds);
    if (linksError) {
      throw new RuntimeError(
        "infrastructure",
        "database_operation_failed",
        "The data operation could not be completed",
        503,
        true,
        "Retry later.",
        { cause: linksError },
      );
    }
    const medicineIds = [
      ...new Set((links ?? []).map((link: { medicine_id: string }) => link.medicine_id)),
    ];
    if (medicineIds.length === 0) return [];

    const { data: rows, error } = await this.database.from("medicines")
      .select(MEDICINE_WITH_INGREDIENTS_SELECT)
      .in("id", medicineIds).eq("status", "active").is("deleted_at", null);
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "database_operation_failed",
        "The data operation could not be completed",
        503,
        true,
        "Retry later.",
        { cause: error },
      );
    }
    const results: BrandMedicine[] = [];
    for (const row of (rows ?? []) as MedicineWithIngredientsRow[]) {
      const medicine = toBrandMedicine(row);
      if (medicine) results.push(medicine);
    }
    return results;
  }
}
