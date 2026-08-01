import { z } from "zod";

export const schema = z.object({
  term: z.string().trim().min(2).max(120),
  types: z.array(z.enum(["brand", "generic"])).min(1).max(2).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(500).optional(),
});
