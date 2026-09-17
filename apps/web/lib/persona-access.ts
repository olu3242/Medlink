import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";

import {
  canAccessPortal,
  roles,
  resolveActiveMembership,
  safeReturnPath,
  WORKSPACE_COOKIE,
  type ActivePortal,
  type Role,
} from "@medlink/platform";

import { createSupabaseServerClient } from "./supabase/server";

type PersonaRoute = ActivePortal;

export function canAccessPersona(persona: PersonaRoute, candidateRoles: readonly string[]) {
  return candidateRoles.some((role) => roles.includes(role as Role) && canAccessPortal(role as Role, persona));
}

export async function requirePersonaAccess(persona: PersonaRoute) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    const pathname = (await headers()).get("x-medlink-pathname");
    const returnPath = safeReturnPath(pathname, `/${persona}`);

    redirect(
      `/auth/sign-in?error=auth_required&next=${encodeURIComponent(returnPath)}`,
    );
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("*")
    .eq("user_id", auth.user.id)
    .is("deleted_at", null);

  const cookieTenantId = (await cookies()).get(WORKSPACE_COOKIE)?.value;

  const metadataTenantId =
    typeof auth.user.app_metadata.active_tenant_id === "string"
      ? auth.user.app_metadata.active_tenant_id
      : undefined;

  const activeTenantId = cookieTenantId ?? metadataTenantId;

  const membership = resolveActiveMembership(
    memberships ?? [],
    activeTenantId,
  );

  if (
    membershipError ||
    !membership ||
    !roles.includes(membership.role as Role) ||
    !canAccessPortal(membership.role as Role, persona)
  ) {
    redirect(
      `/auth/workspaces?error=${
        membershipError ? "auth_unavailable" : "permission_denied"
      }`,
    );
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", membership.organization_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (organizationError || !organization) redirect("/auth/workspaces?error=permission_denied");

  const profileName =
    auth.user.user_metadata.full_name ??
    auth.user.user_metadata.name;

  return {
    role: membership.role as Role,
    memberships: memberships ?? [],
    organizationId: membership.organization_id,
    organizationName:
      typeof organization?.name === "string"
        ? organization.name
        : "Organization context",
    userId: auth.user.id,
    userEmail: auth.user.email ?? "Authenticated user",
    userName:
      typeof profileName === "string"
        ? profileName
        : auth.user.email ?? "Authenticated user",
  };
}
