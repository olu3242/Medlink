import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toBrandMedicine,
  toGenericMedicine,
  type BrandMedicine,
  type GenericMedicine,
  type GenericMedicineRow,
  type MedicineWithIngredientsRow,
} from "@medlink/medicine";
import { SearchUnavailableError } from "./errors";
import type { SearchMedicineReader } from "./ports";

export class SupabaseSearchMedicineReader implements SearchMedicineReader {
  constructor(private readonly database: SupabaseClient) {}

  async findBrandsByIds(ids: readonly string[]): Promise<readonly BrandMedicine[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.database.from("medicines")
      .select("*, medicine_ingredients(active_ingredient_id, amount, unit)")
      .in("id", ids).is("deleted_at", null);
    if (error) throw new SearchUnavailableError(error);
    return ((data ?? []) as MedicineWithIngredientsRow[])
      .map(toBrandMedicine)
      .filter((medicine): medicine is BrandMedicine => medicine !== null);
  }

  async findGenericsByIds(ids: readonly string[]): Promise<readonly GenericMedicine[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.database.from("generics")
      .select("*, therapeutic_classes(name)")
      .in("id", ids).is("deleted_at", null);
    if (error) throw new SearchUnavailableError(error);
    return ((data ?? []) as GenericMedicineRow[])
      .map(toGenericMedicine)
      .filter((medicine): medicine is GenericMedicine => medicine !== null);
  }
}
