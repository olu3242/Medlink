import { z } from "zod";
import { CatalogEquivalencyService } from "@medlink/medicine";
import { RuntimeError } from "@medlink/runtime";
import { SupabaseMedicineCatalogReader } from "../../../../../../lib/medicine-repository";
import { runApi } from "../../../../../../lib/api-server";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

// Closes the "propose() is a disconnected pure function" gap noted in the
// Wave 2 wiring pass: assertReviewed() already had a real caller
// (PATCH /api/v1/equivalents/{id}/review), but propose() - the algorithmic
// candidate-finding half of Batch 2.2 - was never invoked from any route.
export const GET = async (request: Request, route: Context) => {
  const id = idSchema.parse((await route.params).id);
  return runApi(request, {
    name: "catalog.equivalents.propose",
    permission: "medicine:read",
    schema: z.object({ id: idSchema }),
    input: async () => ({ id }),
    execute: async (input, _context, database) => {
      const reader = new SupabaseMedicineCatalogReader(database);
      const source = await reader.findBrandById(input.id);
      if (!source) {
        throw new RuntimeError(
          "validation",
          "medicine_not_found",
          "The source medicine was not found or does not pass domain validation",
          404,
        );
      }
      return new CatalogEquivalencyService(reader).propose({
        brandId: source.id,
        ingredients: source.ingredients,
        dosageForm: source.dosageForm,
        route: source.route,
      });
    },
    success: (data) => Response.json({
      data,
      meta: { requiresPharmacistReview: true, mayAutoSubstitute: false },
    }),
  });
};
