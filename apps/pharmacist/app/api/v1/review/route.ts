import {
  PharmacistReviewService,
  SupabasePharmacistReviewRepository,
} from "@medlink/clinical";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "clinical.reviews.list",
  permission: "clinical:review",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new PharmacistReviewService(
      new SupabasePharmacistReviewRepository(database),
    ).list(context.organizationId),
});
