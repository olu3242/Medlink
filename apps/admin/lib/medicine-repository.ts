import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brandMedicineSchema,
  normalizeMedicineName,
  type BrandMedicine,
  type MedicineCatalogReader,
} from "@medlink/medicine";
import { RuntimeError } from "@medlink/runtime";

interface MedicineIngredientRow {
  active_ingredient_id: string;
  amount: string;
  unit: string;
}

interface MedicineWithIngredientsRow {
  id: string;
  brand_name: string;
  manufacturer_name: string | null;
  dosage_form: string;
  route: string;
  status: string;
  created_at: string;
  updated_at: string;
  medicine_ingredients?: MedicineIngredientRow[] | null;
}

// Shared with apps/admin/lib/medicine-search.ts's SupabaseSearchMedicineReader
// (Sprint 4 dedup philosophy: one row->domain mapping, not two copies of it).
// medicines stores dosage_form/route/manufacturer_name/ingredient unit as
// free text, not the closed vocabularies packages/medicine models
// (dosageForms/administrationRoutes/strengthUnits); a row outside those
// vocabularies fails domain validation, so this returns null for it rather
// than throwing or silently coercing.
export function toBrandMedicine(row: MedicineWithIngredientsRow): BrandMedicine | null {
  const candidate = {
    id: row.id,
    brandName: row.brand_name,
    normalizedName: normalizeMedicineName(row.brand_name),
    manufacturer: row.manufacturer_name ?? "",
    ingredients: (row.medicine_ingredients ?? []).map((ingredient) => ({
      genericId: ingredient.active_ingredient_id,
      amount: Number(ingredient.amount),
      unit: ingredient.unit,
    })),
    dosageForm: row.dosage_form,
    route: row.route,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const parsed = brandMedicineSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const MEDICINE_WITH_INGREDIENTS_SELECT =
  "*, medicine_ingredients(active_ingredient_id, amount, unit)";

// Backs packages/medicine's MedicineCatalogReader port, the read side
// CatalogEquivalencyService.propose() needs to find ingredient-matching
// brand medicines. Only the brand path is implemented: there is no
// first-class generic-medicine entity in the schema (medicines stores
// brand_name/generic_name as two text columns on one row, not related
// brand/generic entities) - see docs/wave-2-certification.md "known gaps."
// findGenericById returns null (an honest "not found"), matching the
// findGenericsByIds precedent already established in medicine-search.ts.
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

  async findGenericById() {
    return null;
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
