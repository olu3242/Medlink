export const roles = [
  "platform_admin",
  "tenant_admin",
  "pharmacist",
  "pharmacy_owner",
  "pharmacy_staff",
  "inventory_manager",
  "patient",
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "organization:read",
  "organization:manage",
  "member:manage",
  "clinical:review",
  "medicine:read",
  "medicine:manage",
  "prescription:read",
  "prescription:create",
  "inventory:read",
  "inventory:manage",
  "reservation:read",
  "reservation:create",
  "mar:read",
  "mar:create",
  "mar:transition",
] as const;

export type Permission = (typeof permissions)[number];
