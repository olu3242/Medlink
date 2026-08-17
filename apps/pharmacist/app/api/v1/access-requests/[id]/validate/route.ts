import { z } from "zod";
import { runApi } from "../../../../../../lib/api-server";
import { AccessReviewApplication } from "../../../../../../lib/access-review-application";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, route: Context) {
  const id = z.string().uuid().parse((await route.params).id);
  return runApi(request, {
    name: "mar.validate",
    permission: "mar:transition",
    schema: z.object({ id: z.string().uuid() }),
    input: async () => ({ id }),
    execute: async (input, context, database) =>
      new AccessReviewApplication(database).validateMar(context, input.id),
  });
}
