import { z } from "zod";

const idSchema = z.string().uuid();

export const validateSchema = z.object({
  medicineId: idSchema,
  patientAllergies: z.array(z.string().trim().min(1)).default([]),
  activeIngredientIds: z.array(idSchema).default([]),
  currentMedicineIds: z.array(idSchema).default([]),
  summary: z.string().trim().min(1).max(2000).optional(),
});
