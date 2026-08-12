import {
  CanonicalMedicineCatalog,
  SupabaseCanonicalMedicineRepository,
} from "@medlink/medicine";
import { z } from "zod";
import { runApi } from "../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "patient.medicines.get",
    permission: "medicine:read",
    schema: z.object({}),
    input: async () => ({}),
    execute: async (_input, _context, database) =>
      new CanonicalMedicineCatalog(
        new SupabaseCanonicalMedicineRepository(database),
      ).find(id),
  });
};
