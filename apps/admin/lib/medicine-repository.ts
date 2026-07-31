import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brandMedicineSchema,
  genericMedicineSchema,
  normalizeMedicineName,
  type BrandMedicine,
  type GenericMedicine,
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

interface GenericRow {
  id: string;
  canonical_name: string;
  controlled_substance: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  therapeutic_classes: { name: string } | { name: string }[] | null;
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

// Shared with apps/admin/lib/medicine-search.ts's SupabaseSearchMedicineReader,
// same reasoning as toBrandMedicine above. generics.therapeutic_class_id is
// nullable (a generic can exist before it's classified), but
// genericMedicineSchema requires a non-empty therapeuticClass name -- a
// generic with no class assigned yet fails domain validation and this
// returns null for it, the same honest-gap precedent toBrandMedicine set
// for out-of-vocabulary dosage forms/routes.
export function toGenericMedicine(row: GenericRow): GenericMedicine | null {
  const relation = Array.isArray(row.therapeutic_classes)
    ? row.therapeutic_classes[0]
    : row.therapeutic_classes;
  const candidate = {
    id: row.id,
    canonicalName: row.canonical_name,
    normalizedName: normalizeMedicineName(row.canonical_name),
    therapeuticClass: relation?.name ?? "",
    controlled: row.controlled_substance,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const parsed = genericMedicineSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

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
      .maybeSingle<GenericRow>();
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
