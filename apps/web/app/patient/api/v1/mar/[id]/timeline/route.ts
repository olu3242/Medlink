import { z } from "zod";
import { AccessApplication } from "../../../../../../../lib/patient/application";
import { runExperienceApi } from "../../../../../../../lib/patient/api-server";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, route: Context) => {
  const id = z.string().uuid().parse((await route.params).id);
  return runExperienceApi(request, "patient.mar.timeline", {
    name: "mar.timeline", permission: "mar:read", schema: z.object({ id: z.string().uuid() }),
    input: async () => ({ id }),
    execute: (input, context, database) => new AccessApplication(database).timeline(context.organizationId, input.id),
  });
};
