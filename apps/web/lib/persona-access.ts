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
  if (!auth.user) redirect(`/auth/sign-in?next=/${persona}`);

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
    redirect("/?error=forbidden");
  }
  return { role: membership.role as Role, organizationId: membership.organization_id };
}
