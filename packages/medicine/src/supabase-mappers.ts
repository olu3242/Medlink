import type { BrandMedicine, GenericMedicine } from "./models";
import {
  brandMedicineSchema,
  genericMedicineSchema,
  normalizeMedicineName,
} from "./validation";

export interface MedicineIngredientRow {
  active_ingredient_id: string;
  amount: string;
  unit: string;
}

export interface MedicineWithIngredientsRow {
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

export interface GenericMedicineRow {
  id: string;
  canonical_name: string;
  controlled_substance: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  therapeutic_classes: { name: string } | { name: string }[] | null;
}

export function toBrandMedicine(row: MedicineWithIngredientsRow): BrandMedicine | null {
  const parsed = brandMedicineSchema.safeParse({
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
  });
  return parsed.success ? parsed.data : null;
}

export function toGenericMedicine(row: GenericMedicineRow): GenericMedicine | null {
  const relation = Array.isArray(row.therapeutic_classes)
    ? row.therapeutic_classes[0]
    : row.therapeutic_classes;
  const parsed = genericMedicineSchema.safeParse({
    id: row.id,
    canonicalName: row.canonical_name,
    normalizedName: normalizeMedicineName(row.canonical_name),
    therapeuticClass: relation?.name ?? "",
    controlled: row.controlled_substance,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return parsed.success ? parsed.data : null;
}
