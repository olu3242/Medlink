import { z } from "zod";
import {
  administrationRoutes,
  dosageForms,
  medicineStatuses,
  strengthUnits,
  type BrandMedicine,
  type GenericMedicine,
} from "./models";

const normalizedText = z.string().trim().min(1).max(200);
const idSchema = z.string().uuid();

export const ingredientStrengthSchema = z.object({
  genericId: idSchema,
  amount: z.number().positive().finite(),
  unit: z.enum(strengthUnits),
}).strict();

const timestamps = {
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};

export const genericMedicineSchema = z.object({
  id: idSchema,
  canonicalName: normalizedText,
  normalizedName: normalizedText,
  therapeuticClass: normalizedText,
  controlled: z.boolean(),
  status: z.enum(medicineStatuses),
  ...timestamps,
}).strict();

export const brandMedicineSchema = z.object({
  id: idSchema,
  brandName: normalizedText,
  normalizedName: normalizedText,
  manufacturer: normalizedText,
  ingredients: z.array(ingredientStrengthSchema).min(1),
  dosageForm: z.enum(dosageForms),
  route: z.enum(administrationRoutes),
  status: z.enum(medicineStatuses),
  ...timestamps,
}).strict();

export const createGenericMedicineSchema = genericMedicineSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const createBrandMedicineSchema = brandMedicineSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateGenericMedicine = z.infer<typeof createGenericMedicineSchema>;
export type CreateBrandMedicine = z.infer<typeof createBrandMedicineSchema>;

export function normalizeMedicineName(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
}

export function parseGenericMedicine(value: unknown): GenericMedicine {
  return genericMedicineSchema.parse(value);
}

export function parseBrandMedicine(value: unknown): BrandMedicine {
  return brandMedicineSchema.parse(value);
}
