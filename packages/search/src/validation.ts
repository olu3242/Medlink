import { z } from "zod";
import type { MedicineSearchQuery } from "./contracts";
import { InvalidSearchQueryError } from "./errors";

export const medicineSearchQuerySchema = z.object({
  term: z.string().trim().min(2).max(120),
  types: z.array(z.enum(["brand", "generic"])).min(1).max(2).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(500).optional(),
}).strict();

export function parseMedicineSearchQuery(value: unknown): MedicineSearchQuery {
  const parsed = medicineSearchQuerySchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidSearchQueryError(parsed.error.issues[0]?.message);
  }
  return {
    term: parsed.data.term,
    ...(parsed.data.types === undefined ? {} : { types: parsed.data.types }),
    ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }),
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  };
}
