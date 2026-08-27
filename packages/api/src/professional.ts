import type { Permission, Role } from "@medlink/platform";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";

export interface ProfessionalOperation {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly permission: Permission;
  readonly roles: readonly Role[];
}

export const professionalOperations: readonly ProfessionalOperation[] = [
  { id: "catalog.medicine.list", method: "GET", path: "/api/v1/medicines", permission: "medicine:read", roles: ["platform_admin", "tenant_admin"] },
  { id: "catalog.medicine.get", method: "GET", path: "/api/v1/medicines/:id", permission: "medicine:read", roles: ["platform_admin", "tenant_admin"] },
  { id: "catalog.medicine.create", method: "POST", path: "/api/v1/medicines", permission: "medicine:manage", roles: ["platform_admin"] },
  { id: "catalog.medicine.update", method: "PATCH", path: "/api/v1/medicines/:id", permission: "medicine:manage", roles: ["platform_admin"] },
  { id: "catalog.medicine.merge", method: "POST", path: "/api/v1/medicines/:id/merge", permission: "medicine:manage", roles: ["platform_admin"] },
  { id: "catalog.alternative.create", method: "POST", path: "/api/v1/medicines/:id/alternatives", permission: "medicine:manage", roles: ["platform_admin"] },
  { id: "catalog.ingredient.create", method: "POST", path: "/api/v1/ingredients", permission: "medicine:manage", roles: ["platform_admin"] },
  { id: "inventory.list", method: "GET", path: "/api/v1/inventory", permission: "inventory:read", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager", "pharmacist"] },
  { id: "inventory.get", method: "GET", path: "/api/v1/inventory/:id", permission: "inventory:read", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager", "pharmacist"] },
  { id: "inventory.create", method: "POST", path: "/api/v1/inventory", permission: "inventory:manage", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager"] },
  { id: "inventory.update", method: "PUT", path: "/api/v1/inventory/:id", permission: "inventory:manage", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager"] },
  { id: "inventory.stock.change", method: "POST", path: "/api/v1/inventory/:id/stock", permission: "inventory:manage", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager"] },
  { id: "inventory.transactions", method: "GET", path: "/api/v1/inventory/:id/transactions", permission: "inventory:read", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager", "pharmacist"] },
  { id: "inventory.availability", method: "GET", path: "/api/v1/inventory/availability", permission: "inventory:read", roles: ["pharmacy_owner", "pharmacy_staff", "inventory_manager", "pharmacist"] },
  { id: "reservation.list", method: "GET", path: "/api/v1/reservations", permission: "reservation:read", roles: ["pharmacy_owner", "pharmacy_staff", "pharmacist"] },
  { id: "reservation.ready", method: "PATCH", path: "/api/v1/reservations/:id/ready", permission: "reservation:manage", roles: ["pharmacy_staff", "pharmacist"] },
  { id: "reservation.collect", method: "PATCH", path: "/api/v1/reservations/:id/collect", permission: "reservation:manage", roles: ["pharmacy_staff", "pharmacist"] },
  { id: "review.list", method: "GET", path: "/api/v1/review", permission: "clinical:review", roles: ["pharmacist"] },
  { id: "review.decide", method: "PATCH", path: "/api/v1/review/:id", permission: "clinical:review", roles: ["pharmacist"] },
  { id: "provider.activity", method: "GET", path: "/api/v1/provider/activity", permission: "prescription:read", roles: ["provider"] },
  { id: "provider.prescription", method: "POST", path: "/api/v1/provider/prescriptions", permission: "prescription:create", roles: ["provider"] },
] as const;

export function operationsFor(role: Role): readonly ProfessionalOperation[] {
  return professionalOperations.filter((operation) => operation.roles.includes(role));
}
