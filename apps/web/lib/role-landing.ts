const roleDestinations = {
  platform_admin: "/admin",
  tenant_admin: "/admin",
  patient: "/patient",
  pharmacist: "/pharmacist",
  pharmacy_owner: "/pharmacy",
  pharmacy_staff: "/pharmacy",
  inventory_manager: "/pharmacy/inventory",
} as const;

export type UnifiedPortalRole = keyof typeof roleDestinations;

const rolePriority: readonly UnifiedPortalRole[] = [
  "platform_admin",
  "tenant_admin",
  "pharmacist",
  "pharmacy_owner",
  "inventory_manager",
  "pharmacy_staff",
  "patient",
];

export function resolveRoleLanding(roles: readonly string[]): string {
  const effectiveRole = rolePriority.find((role) => roles.includes(role));
  return effectiveRole ? roleDestinations[effectiveRole] : "/";
}
