import { z } from "zod";
import { AccessApplication } from "../../../../lib/application";
import { runExperienceApi } from "../../../../lib/api-server";

export const GET = (request: Request) => runExperienceApi(
  request,
  "pharmacist.review.list",
  {
    name: "clinical.reviews.list",
    permission: "clinical:review",
    schema: z.object({}),
    input: async () => ({}),
    execute: async (_input, context, database) =>
      new AccessApplication(database).reviews(context.organizationId),
  },
);
