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

export interface ActiveSession {
  role: Role;
  memberships: readonly { organization_id: string; role: string }[];
  organizationId: string;
  organizationName: string;
  userId: string;
  userEmail: string;
  userName: string;
}

type SessionResolution =
  | { ok: true; session: ActiveSession }
  | { ok: false; reason: "unauthenticated" | "auth_unavailable" | "permission_denied" };

/**
 * Resolves the authenticated user's active membership/role/organization
 * without any portal check or redirect, for callers (like an API route)
 * that need to fail with a response rather than a navigation.
 */
async function resolveSession(): Promise<SessionResolution> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, reason: "unauthenticated" };

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

  if (membershipError) return { ok: false, reason: "auth_unavailable" };
  if (!membership || !roles.includes(membership.role as Role)) return { ok: false, reason: "permission_denied" };

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", membership.organization_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (organizationError || !organization) return { ok: false, reason: "permission_denied" };

  const profileName =
    auth.user.user_metadata.full_name ??
    auth.user.user_metadata.name;

  return {
    ok: true,
    session: {
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
    },
  };
}

/**
 * For API routes: resolves the active session and returns null on any
 * failure, instead of redirecting. Portal access is not checked here --
 * callers that are not scoped to one persona portal (e.g. global search)
 * only need an authenticated user with a valid active membership.
 */
export async function resolveActiveSession(): Promise<ActiveSession | null> {
  const result = await resolveSession();
  return result.ok ? result.session : null;
}

export async function requirePersonaAccess(persona: PersonaRoute) {
  const result = await resolveSession();

  if (!result.ok) {
    if (result.reason === "unauthenticated") {
      const pathname = (await headers()).get("x-medlink-pathname");
      const returnPath = safeReturnPath(pathname, `/${persona}`);
      redirect(`/auth/sign-in?error=auth_required&next=${encodeURIComponent(returnPath)}`);
    }
    redirect(`/auth/workspaces?error=${result.reason}`);
  }

  if (!canAccessPortal(result.session.role, persona)) {
    redirect("/auth/workspaces?error=permission_denied");
  }

  return result.session;
}
