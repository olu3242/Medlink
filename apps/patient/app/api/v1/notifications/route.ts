import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";
export const GET = (request: Request) => runExperienceApi(request, "patient.notification.list", {
  name: "notifications.list", permission: "mar:read", schema: z.object({}), input: async () => ({}),
  execute: (_input, context, database) => new AccessApplication(database).notifications(context.organizationId, context.userId),
});
