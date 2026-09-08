import { redirect } from "next/navigation";

import { canAccessPortal, roles, type ActivePortal, type Role } from "@medlink/platform";

import { createSupabaseServerClient } from "./supabase/server";

export type PersonaRoute = ActivePortal;

export function canAccessPersona(persona: PersonaRoute, candidateRoles: readonly string[]) {
  return candidateRoles.some((role) => roles.includes(role as Role) && canAccessPortal(role as Role, persona));
}

export async function requirePersonaAccess(persona: PersonaRoute) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/auth/sign-in?error=auth_required&next=/${persona}`);

  const { data: memberships, error } = await supabase
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .is("deleted_at", null);

  const activeTenant = typeof auth.user.app_metadata.active_tenant_id === "string"
    ? auth.user.app_metadata.active_tenant_id
    : undefined;
  const membership = activeTenant
    ? memberships?.find(({ organization_id }) => organization_id === activeTenant)
    : memberships?.length === 1 ? memberships[0] : undefined;
  if (error || !membership || !roles.includes(membership.role as Role) || !canAccessPortal(membership.role as Role, persona)) {
    redirect(`/auth/sign-in?error=permission_denied&next=/${persona}`);
  }
  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.organization_id)
    .maybeSingle();
  const profileName = auth.user.user_metadata.full_name ?? auth.user.user_metadata.name;
  return {
    role: membership.role as Role,
    organizationId: membership.organization_id,
    organizationName: typeof organization?.name === "string" ? organization.name : "Organization context",
    userEmail: auth.user.email ?? "Authenticated user",
    userName: typeof profileName === "string" && profileName.trim() ? profileName : auth.user.email ?? "Authenticated user",
  };
}
