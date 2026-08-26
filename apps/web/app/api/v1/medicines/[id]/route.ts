import { z } from "zod";
import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
} from "@medlink/medicine";
import { runApi } from "@medlink/api";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.medicines.get",
    permission: "medicine:read",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, _context, database) =>
      new CanonicalMedicineCatalog(
        new SupabaseCanonicalMedicineRepository(database),
      ).find(input.id),
  });
};
