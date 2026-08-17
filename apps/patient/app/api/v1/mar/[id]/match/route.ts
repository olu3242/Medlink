import { z } from "zod";
import { AccessApplication } from "../../../../../../lib/application";
import { runExperienceApi } from "../../../../../../lib/api-server";

const bodySchema = z.object({
  inventoryBatchId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
});

type Context = { params: Promise<{ id: string }> };

export const POST = async (request: Request, route: Context) => {
  const id = z.string().uuid().parse((await route.params).id);
  return runExperienceApi(request, "patient.inventory.match", {
    name: "inventory.match",
    permission: "inventory:read",
    schema: z.object({ id: z.string().uuid(), body: bodySchema }),
    input: async (value) => ({ id, body: await value.json() }),
    execute: async (input, context, database) =>
      new AccessApplication(database).matchInventory(context, input.id, input.body),
  });
};
