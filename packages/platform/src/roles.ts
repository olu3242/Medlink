export const roles = [
  "platform_admin",
  "tenant_admin",
  "pharmacist",
  "pharmacy_owner",
  "pharmacy_staff",
  "inventory_manager",
  "provider",
  "patient",
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "organization:read",
  "organization:manage",
  "member:manage",
  "patient:read",
  "patient:manage",
  "clinical:review",
  "medicine:read",
  "medicine:manage",
  "prescription:read",
  "prescription:create",
  "inventory:read",
  "inventory:manage",
  "reservation:read",
  "reservation:create",
  "reservation:manage",
  "reservation:credential",
  "payment:read",
  "payment:create",
  "mar:read",
  "mar:create",
  "mar:transition",
  "assistant:use",
] as const;

export type Permission = (typeof permissions)[number];
