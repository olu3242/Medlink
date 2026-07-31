import { z } from "zod";
import { AccessApplication } from "../../../../../lib/application";
import { runApi } from "../../../../../lib/api-server";

type Context = { params: Promise<{ id: string }> };

export const GET = async (request: Request, route: Context) => {
  const id = z.string().uuid().parse((await route.params).id);
  return runApi(request, {
    name: "mar.get",
    permission: "mar:read",
    schema: z.object({ id: z.string().uuid() }),
    input: async () => ({ id }),
    execute: async (input, context, database) =>
      new AccessApplication(database).getMar(context.organizationId, input.id),
  });
};
