import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

import {
  AuthenticationError,
  parseRequestContext,
  TenantContextError,
} from "@medlink/platform";

import { createSupabaseServerClient } from "./supabase/server";

export async function resolveRequestContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthenticationError();

  const requestHeaders = await headers();
  const tenantId =
    requestHeaders.get("x-medlink-tenant-id") ??
    user.app_metadata.active_tenant_id;
  if (typeof tenantId !== "string") throw new TenantContextError();

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", tenantId)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();
  if (!membership) throw new TenantContextError("Tenant membership is invalid");

  return parseRequestContext({
    correlationId: requestHeaders.get("x-correlation-id") ?? randomUUID(),
    userId: user.id,
    tenantId,
    role: membership.role,
  });
}
