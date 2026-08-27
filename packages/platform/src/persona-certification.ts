import { z } from "zod";
import { roles, type Role } from "./roles";

export const personaCertificationMatrix = [
  { persona: "platform_admin", role: "platform_admin", portal: "admin", workspace: "/persona-test", tenantRequired: true, pharmacyRequired: false, emailEnv: "MEDLINK_TEST_PLATFORM_ADMIN_EMAIL" },
  { persona: "tenant_admin", role: "tenant_admin", portal: "dashboard", workspace: "/", tenantRequired: true, pharmacyRequired: false, emailEnv: "MEDLINK_TEST_TENANT_ADMIN_EMAIL" },
  { persona: "patient", role: "patient", portal: "patient", workspace: "/search", tenantRequired: true, pharmacyRequired: false, emailEnv: "MEDLINK_TEST_PATIENT_EMAIL" },
  { persona: "pharmacist", role: "pharmacist", portal: "pharmacist", workspace: "/", tenantRequired: true, pharmacyRequired: true, emailEnv: "MEDLINK_TEST_PHARMACIST_EMAIL" },
  { persona: "pharmacy_owner", role: "pharmacy_owner", portal: "pharmacy", workspace: "/", tenantRequired: true, pharmacyRequired: true, emailEnv: "MEDLINK_TEST_PHARMACY_OWNER_EMAIL" },
  { persona: "pharmacy_staff", role: "pharmacy_staff", portal: "pharmacy", workspace: "/", tenantRequired: true, pharmacyRequired: true, emailEnv: "MEDLINK_TEST_PHARMACY_STAFF_EMAIL" },
  { persona: "inventory_manager", role: "inventory_manager", portal: "pharmacy", workspace: "/inventory", tenantRequired: true, pharmacyRequired: true, emailEnv: "MEDLINK_TEST_INVENTORY_MANAGER_EMAIL" },
  { persona: "provider", role: "provider", portal: "provider", workspace: "/", tenantRequired: true, pharmacyRequired: false, emailEnv: "MEDLINK_TEST_PROVIDER_EMAIL" },
] as const satisfies readonly {
  persona: Role; role: Role; portal: string; workspace: string;
  tenantRequired: boolean; pharmacyRequired: boolean; emailEnv: string;
}[];

export const testAsPurposeSchema = z.enum([
  "catalog_certification", "pharmacy_onboarding_certification",
  "reservation_certification", "auth_regression", "release_certification",
]);

export const testAsRequestSchema = z.object({
  targetSubjectId: z.string().uuid(),
  targetMembershipId: z.string().uuid(),
  targetRole: z.enum(roles).exclude(["platform_admin"]),
  targetTenantId: z.string().uuid(),
  targetPharmacyLocationId: z.string().uuid().optional(),
  purpose: testAsPurposeSchema,
});

export interface TestAsActor {
  readonly userId: string;
  readonly role: Role;
  readonly activeTestAsSessionId?: string;
}

export function authorizeTestAsRequest(actor: TestAsActor, expiresAt: Date, now = new Date()): void {
  if (actor.role !== "platform_admin") throw new Error("Platform administrator role required");
  if (actor.activeTestAsSessionId) throw new Error("Nested Test-As sessions are prohibited");
  const lifetime = expiresAt.getTime() - now.getTime();
  if (lifetime <= 0 || lifetime > 15 * 60_000) throw new Error("Test-As expiry must be within 15 minutes");
}
