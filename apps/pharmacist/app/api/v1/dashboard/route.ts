import { SupabasePharmacistDashboard } from "@medlink/clinical";
import { z } from "zod";
import { runApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runApi(request, {
  name: "clinical.dashboard.get",
  permission: "clinical:review",
  schema: z.object({}),
  input: async () => ({}),
  execute: async (_input, context, database) =>
    new SupabasePharmacistDashboard(database).get(context.organizationId),
});
