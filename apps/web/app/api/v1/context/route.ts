import { runWebApi } from "../../../../lib/api-runtime";
export const GET = (request: Request) => runWebApi(request, {
  name: "platform.context.get",
  permission: "organization:read",
  async execute(context) {
    return {
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      role: context.role,
    };
  },
});
