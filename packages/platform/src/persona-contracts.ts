import { can } from "./authorization";
import type { Permission, Role } from "./roles";

export const canonicalPersonas = [
  "PATIENT", "PHARMACIST", "PHARMACY_STAFF", "PHARMACY_MANAGER",
  "PROVIDER", "FINANCE_OPS", "SUPPORT_OPS", "MEDLINK_ADMIN", "AI_AGENT",
] as const;
export type CanonicalPersona = (typeof canonicalPersonas)[number];
export type ActivePortal = "patient" | "pharmacist" | "pharmacy" | "admin";
export type PersonaTheme = "patient" | "pharmacist" | "pharmacy" | "pharmacy-manager" | "admin";
export type ObjectAction = "READ" | "CREATE" | "UPDATE" | "DELETE" | "RECOMMEND" | "APPROVE" | "EXECUTE" | "CANCEL" | "REFUND" | "SETTLE" | "CONFIGURE" | "GOVERN";
export type ObjectScope = "own" | "organization" | "assigned" | "network" | "none";
export type FieldVisibility = "hidden" | "masked" | "read_only" | "editable";

export interface PersonaNavigationItem { readonly label: string; readonly href: string; readonly permission?: Permission; }
export interface ObjectPermission { readonly object: string; readonly actions: readonly ObjectAction[]; readonly scope: ObjectScope; readonly conditions?: readonly string[]; }
export interface FieldPolicy { readonly object: string; readonly fields: Readonly<Record<string, FieldVisibility>>; }
export interface WorkflowPolicy { readonly workflow: string; readonly action: ObjectAction; readonly allowedStates: readonly string[]; }
export interface PersonaContract {
  readonly persona: CanonicalPersona;
  readonly role: Role;
  readonly portal: ActivePortal;
  readonly primaryGoal: string;
  readonly navigation: readonly PersonaNavigationItem[];
  readonly allowedRoutes: readonly string[];
  readonly theme: PersonaTheme;
  readonly capabilities: readonly Permission[];
  readonly objectPermissions: readonly ObjectPermission[];
  readonly fieldPolicies: readonly FieldPolicy[];
  readonly workflowPolicies: readonly WorkflowPolicy[];
}

const allPermissions: readonly Permission[] = [
  "organization:read", "organization:manage", "member:manage", "patient:read", "patient:manage",
  "clinical:review", "medicine:read", "medicine:manage", "prescription:read", "prescription:create",
  "inventory:read", "inventory:manage", "reservation:read", "reservation:create", "reservation:manage",
  "reservation:credential", "payment:read", "payment:create", "mar:read", "mar:create", "mar:transition",
  "assistant:use", "partner:read", "partner:apply", "partner:review", "partner:manage",
];
const capabilitiesFor = (role: Role) => allPermissions.filter((permission) => can(role, permission));

const patientInventory: FieldPolicy = { object: "Inventory", fields: {
  inventoryId: "read_only", pharmacyLocationId: "read_only", medicineName: "read_only",
  pharmacyName: "read_only", stockStatus: "read_only", publicPrice: "read_only", distance: "read_only",
  batchNumber: "hidden", supplier: "hidden", quantityReserved: "hidden", costPrice: "hidden", adjustmentHistory: "hidden",
} };
const clinicalInventory: FieldPolicy = { object: "Inventory", fields: {
  id: "read_only", medicineId: "read_only", brandName: "read_only", genericName: "read_only",
  strength: "read_only", dosageForm: "read_only", availableQuantity: "read_only", quantityReserved: "read_only",
  batchNumber: "read_only", expiresOn: "read_only", manufacturer: "read_only", registrationNumber: "read_only",
  pharmacyName: "read_only", unit: "read_only", availabilityState: "read_only", recordStatus: "read_only",
  supplier: "hidden", costPrice: "hidden", adjustmentHistory: "hidden",
} };
const staffInventory: FieldPolicy = { object: "Inventory", fields: {
  id: "read_only", medicineId: "read_only", pharmacyLocationId: "read_only", pharmacyName: "read_only",
  brandName: "read_only", genericName: "read_only", strength: "read_only", dosageForm: "read_only",
  batchNumber: "editable", quantityOnHand: "editable", quantityReserved: "read_only", availableQuantity: "read_only",
  expiresOn: "editable", unit: "editable", availabilityState: "read_only", recordStatus: "editable",
  receivedOn: "editable", unitPriceMinor: "editable", currencyCode: "editable", lowStockThreshold: "editable",
  version: "read_only", createdAt: "read_only", updatedAt: "read_only",
  supplier: "hidden", costPrice: "hidden", margin: "hidden",
} };
const managerInventory: FieldPolicy = { object: "Inventory", fields: {
  ...staffInventory.fields, supplier: "editable", costPrice: "read_only", sellPrice: "editable", margin: "read_only", stockAging: "read_only",
} };
const adminInventory: FieldPolicy = { object: "Inventory", fields: {
  id: "read_only", organizationId: "read_only", medicineId: "read_only", pharmacyLocationId: "read_only",
  provenance: "read_only", mappingState: "read_only", normalizationState: "read_only",
  integrationState: "read_only", auditMetadata: "read_only",
} };

const patient: PersonaContract = {
  persona: "PATIENT", role: "patient", portal: "patient", theme: "patient",
  primaryGoal: "Find, reserve, and safely collect prescribed medicine",
  navigation: [
    { label: "Home", href: "/patient" }, { label: "Find Medicine", href: "/patient/search", permission: "medicine:read" },
    { label: "Reservations", href: "/patient/reservations", permission: "reservation:read" },
    { label: "Prescriptions", href: "/patient/prescriptions", permission: "prescription:read" },
    { label: "Profile", href: "/patient/profile", permission: "patient:read" },
  ],
  allowedRoutes: ["/patient", "/patient/search", "/patient/medicines", "/patient/reservations", "/patient/prescriptions", "/patient/profile", "/patient/assistant", "/patient/mar", "/patient/reserve"],
  capabilities: capabilitiesFor("patient"),
  objectPermissions: [
    { object: "Medicine", actions: ["READ"], scope: "network" }, { object: "Pharmacy", actions: ["READ"], scope: "network" },
    { object: "Prescription", actions: ["READ", "CREATE"], scope: "own" }, { object: "Reservation", actions: ["READ", "CREATE"], scope: "own" },
    { object: "Payment", actions: ["READ", "CREATE"], scope: "own" }, { object: "Profile", actions: ["READ", "UPDATE"], scope: "own" },
  ], fieldPolicies: [patientInventory], workflowPolicies: [{ workflow: "Reservation", action: "CANCEL", allowedStates: [] }],
};
const pharmacist: PersonaContract = {
  persona: "PHARMACIST", role: "pharmacist", portal: "pharmacist", theme: "pharmacist",
  primaryGoal: "Review clinical requests and make safe, licensed decisions",
  navigation: [{ label: "Workspace", href: "/pharmacist" }, { label: "Clinical Queue", href: "/pharmacist", permission: "clinical:review" }],
  allowedRoutes: ["/pharmacist", "/pharmacist/review", "/pharmacist/access-review"], capabilities: capabilitiesFor("pharmacist"),
  objectPermissions: [
    { object: "Medicine", actions: ["READ", "RECOMMEND"], scope: "network" },
    { object: "Prescription", actions: ["READ"], scope: "assigned" },
    { object: "ClinicalReview", actions: ["READ", "RECOMMEND", "APPROVE"], scope: "assigned" },
    { object: "Inventory", actions: ["READ"], scope: "organization" },
    { object: "Reservation", actions: ["READ", "EXECUTE"], scope: "organization" },
    { object: "Settlement", actions: [], scope: "none" },
  ], fieldPolicies: [clinicalInventory], workflowPolicies: [{ workflow: "ClinicalReview", action: "APPROVE", allowedStates: ["pending_review"] }],
};
const pharmacyStaff: PersonaContract = {
  persona: "PHARMACY_STAFF", role: "pharmacy_staff", portal: "pharmacy", theme: "pharmacy",
  primaryGoal: "Move reservations and stock through safe fulfillment",
  navigation: [
    { label: "Dashboard", href: "/pharmacy" },
    { label: "Inventory", href: "/pharmacy/inventory", permission: "inventory:read" },
    { label: "Reservations", href: "/pharmacy/reservations", permission: "reservation:read" },
  ],
  allowedRoutes: ["/pharmacy", "/pharmacy/inventory", "/pharmacy/reservations"], capabilities: capabilitiesFor("pharmacy_staff"),
  objectPermissions: [
    { object: "Inventory", actions: ["READ", "CREATE", "UPDATE"], scope: "organization" },
    { object: "Reservation", actions: ["READ", "EXECUTE"], scope: "organization" },
    { object: "ClinicalReview", actions: [], scope: "none" },
  ], fieldPolicies: [staffInventory], workflowPolicies: [{ workflow: "Reservation", action: "EXECUTE", allowedStates: ["created", "confirmed", "ready"] }],
};
const pharmacyManager: PersonaContract = {
  persona: "PHARMACY_MANAGER", role: "pharmacy_owner", portal: "pharmacy", theme: "pharmacy-manager",
  primaryGoal: "Manage pharmacy operations, staff, inventory health, and exceptions",
  navigation: [
    { label: "Overview", href: "/pharmacy" },
    { label: "Inventory", href: "/pharmacy/inventory", permission: "inventory:read" },
    { label: "Reservations", href: "/pharmacy/reservations", permission: "reservation:read" },
  ],
  allowedRoutes: ["/pharmacy", "/pharmacy/inventory", "/pharmacy/reservations"], capabilities: capabilitiesFor("pharmacy_owner"),
  objectPermissions: [
    { object: "Inventory", actions: ["READ", "CREATE", "UPDATE"], scope: "organization" },
    { object: "OrganizationMembership", actions: ["READ", "CREATE", "UPDATE"], scope: "organization" },
    { object: "PlatformPolicy", actions: [], scope: "none" },
  ], fieldPolicies: [managerInventory], workflowPolicies: [],
};
const medlinkAdmin: PersonaContract = {
  persona: "MEDLINK_ADMIN", role: "platform_admin", portal: "admin", theme: "admin",
  primaryGoal: "Govern the MedLink network without assuming clinical authority",
  navigation: [
    { label: "Network Overview", href: "/admin" }, { label: "Organizations", href: "/admin/organizations", permission: "organization:read" },
    { label: "Medicine Catalogue", href: "/admin/catalog", permission: "medicine:read" }, { label: "Pharmacy Network", href: "/admin/pharmacies", permission: "organization:read" },
    { label: "Inventory", href: "/admin/inventory", permission: "inventory:read" }, { label: "Transactions", href: "/admin/reservations", permission: "reservation:read" },
  ], allowedRoutes: ["/admin"], capabilities: capabilitiesFor("platform_admin"),
  objectPermissions: [
    { object: "Organization", actions: ["READ", "CREATE", "UPDATE", "GOVERN"], scope: "network" },
    { object: "Medicine", actions: ["READ", "CREATE", "UPDATE", "GOVERN"], scope: "network" },
    { object: "AuditEvent", actions: ["READ"], scope: "network" }, { object: "ClinicalReview", actions: [], scope: "none" },
  ], fieldPolicies: [adminInventory], workflowPolicies: [],
};

const contracts: Readonly<Partial<Record<Role, PersonaContract>>> = {
  patient, pharmacist, pharmacy_staff: pharmacyStaff, inventory_manager: pharmacyStaff,
  pharmacy_owner: pharmacyManager, platform_admin: medlinkAdmin, tenant_admin: medlinkAdmin,
};

export function personaContractForRole(role: Role): PersonaContract | null { return contracts[role] ?? null; }
export function canAccessPortal(role: Role, portal: ActivePortal): boolean { return personaContractForRole(role)?.portal === portal; }
export function navigationForRole(role: Role): readonly PersonaNavigationItem[] { return personaContractForRole(role)?.navigation.filter((item) => !item.permission || can(role, item.permission)) ?? []; }
export function isRouteAllowed(role: Role, pathname: string): boolean { return personaContractForRole(role)?.allowedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`)) ?? false; }
export function projectPersonaFields<T extends Record<string, unknown>>(role: Role, object: string, record: T): Partial<T> {
  const policy = personaContractForRole(role)?.fieldPolicies.find((candidate) => candidate.object === object);
  if (!policy) return {};
  return Object.fromEntries(Object.entries(record).flatMap(([field, value]) => {
    const visibility = policy.fields[field] ?? "hidden";
    return visibility === "hidden" ? [] : [[field, visibility === "masked" ? "***" : value]];
  })) as Partial<T>;
}
export function canPerformObjectAction(role: Role, object: string, action: ObjectAction, state?: string): boolean {
  const contract = personaContractForRole(role);
  const permission = contract?.objectPermissions.find((candidate) => candidate.object === object);
  if (!permission?.actions.includes(action)) return false;
  const workflow = contract?.workflowPolicies.find((candidate) => candidate.workflow === object && candidate.action === action);
  return !workflow || (state !== undefined && workflow.allowedStates.includes(state));
}
