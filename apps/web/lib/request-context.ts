import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";

import {
  AuthenticationError,
  parseRequestContext,
  resolveActiveMembership,
  TenantContextError,
  WORKSPACE_COOKIE,
} from "@medlink/platform";

import { createSupabaseServerClient } from "./supabase/server";

export async function resolveRequestContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthenticationError();

  const { data: memberships } = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  const requestHeaders = await headers();
  // The workspace-switch cookie is only a preference, matching every other
  // resolver of active membership (persona-access.ts, persona-middleware.ts,
  // runApi's own authenticate()) -- it selects which of the user's own,
  // freshly-read memberships to activate; it never grants membership on its
  // own. Header takes priority over the cookie here because this resolver
  // backs machine-callable /api/v1 routes, matching runApi's own priority.
  const headerTenantId = requestHeaders.get("x-medlink-tenant-id");
  const cookieTenantId = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const metadataTenantId =
    typeof user.app_metadata.active_tenant_id === "string" ? user.app_metadata.active_tenant_id : undefined;
  const requestedTenantId = headerTenantId ?? cookieTenantId ?? metadataTenantId;

  const membership = resolveActiveMembership(memberships ?? [], requestedTenantId);
  if (!membership) throw new TenantContextError();

  return parseRequestContext({
    correlationId: requestHeaders.get("x-correlation-id") ?? randomUUID(),
    userId: user.id,
    tenantId: membership.organization_id,
    role: membership.role,
  });
}
