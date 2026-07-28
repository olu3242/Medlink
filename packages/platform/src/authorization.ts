import { AuthorizationError } from "./errors";
import { permissions, type Permission, type Role } from "./roles";

const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  platform_admin: new Set(permissions),
  tenant_admin: new Set([
    "organization:read", "organization:manage", "member:manage",
    "medicine:read", "medicine:manage", "prescription:read",
    "inventory:read", "reservation:read", "mar:read",
  ]),
  pharmacist: new Set([
    "organization:read", "clinical:review", "inventory:read",
    "medicine:read", "prescription:read", "prescription:create",
    "reservation:read", "mar:read", "mar:transition",
  ]),
  pharmacy_owner: new Set([
    "organization:read", "member:manage", "inventory:read",
    "inventory:manage", "medicine:read", "prescription:read",
    "reservation:read", "mar:read",
  ]),
  pharmacy_staff: new Set([
    "organization:read", "inventory:read", "inventory:manage",
    "medicine:read", "prescription:read", "reservation:read", "mar:read",
  ]),
  inventory_manager: new Set([
    "organization:read", "inventory:read", "inventory:manage", "medicine:read",
  ]),
  patient: new Set([
    "medicine:read", "prescription:read", "prescription:create",
    "inventory:read", "reservation:read", "reservation:create",
    "mar:read", "mar:create",
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function authorize(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new AuthorizationError(role, permission);
}
