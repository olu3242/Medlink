import { runWebApi } from "../../../../lib/api-runtime";
export const GET = (request: Request) => runWebApi(request, {
  name: "platform.context.get",
  // No permission is checked here: this echoes only the caller's own
  // already-resolved identity/tenant/role, which resolveRequestContext()
  // has already authenticated and verified membership for -- every
  // authenticated role should be able to introspect its own session.
  async execute(context) {
    return {
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      role: context.role,
    };
  },
});
