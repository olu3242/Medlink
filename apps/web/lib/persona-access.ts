import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "./supabase/server";

const personaRoles = {
  admin: new Set(["platform_admin", "tenant_admin"]),
  patient: new Set(["patient"]),
  pharmacist: new Set(["pharmacist"]),
  pharmacy: new Set(["pharmacy_owner", "pharmacy_staff", "inventory_manager"]),
} as const;

export type PersonaRoute = keyof typeof personaRoles;

export function canAccessPersona(persona: PersonaRoute, roles: readonly string[]) {
  const allowedRoles: ReadonlySet<string> = personaRoles[persona];
  return roles.some((role) => allowedRoles.has(role));
}

export async function requirePersonaAccess(persona: PersonaRoute) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/auth/sign-in?next=/${persona}`);

  const { data: memberships, error } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("user_id", auth.user.id)
    .is("deleted_at", null);

  if (error || !canAccessPersona(persona, memberships?.map(({ role }) => role) ?? [])) {
    redirect("/?error=forbidden");
  }
}
