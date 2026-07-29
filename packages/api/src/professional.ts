import type { Permission, Role } from "@medlink/platform";

export type HttpMethod = "GET" | "POST" | "PATCH";

export interface ProfessionalOperation {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly permission: Permission;
  readonly roles: readonly Role[];
}

export const professionalOperations: readonly ProfessionalOperation[] = [
  { id: "inventory.list", method: "GET", path: "/api/v1/inventory", permission: "inventory:read", roles: ["pharmacy_staff", "pharmacist", "provider"] },
  { id: "reservation.list", method: "GET", path: "/api/v1/reservations", permission: "reservation:read", roles: ["pharmacy_staff", "pharmacist"] },
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
