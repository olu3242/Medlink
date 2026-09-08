import { can } from "./authorization";
import type { Permission, Role } from "./roles";
import { z } from "zod";

export const fieldAccessStates = ["hidden", "masked", "read_only", "editable"] as const;
export type FieldAccess = (typeof fieldAccessStates)[number];
export type DataScope = "all_organization" | "selected_pharmacies" | "selected_locations" | "own_location" | "own_records";

export const dashboardFilterSchema = z.object({
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  organizationId: z.string().uuid().optional(),
  pharmacyId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/).optional(),
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({ code: "custom", path: ["dateTo"], message: "dateTo must not precede dateFrom" });
  }
  if (value.locationId && !value.pharmacyId) {
    context.addIssue({ code: "custom", path: ["locationId"], message: "locationId requires pharmacyId" });
  }
});
export type DashboardFilters = z.infer<typeof dashboardFilterSchema>;

export interface DashboardWidget {
  readonly id: string;
  readonly title: string;
  readonly dataSource: string;
  readonly requiredPermission: Permission;
  readonly fields: readonly string[];
  readonly scope: DataScope;
  readonly refreshSeconds: number;
  readonly drillDown: string;
}

export interface DashboardDefinition {
  readonly persona: Role;
  readonly navigation: readonly string[];
  readonly widgets: readonly DashboardWidget[];
}

export interface DashboardAuthorizationContext {
  readonly actorId: string;
  readonly subjectId: string;
  readonly role: Role;
  readonly organizationId: string;
  readonly tenantId: string;
  readonly capabilities: readonly Permission[];
  readonly testAsAvailable: false;
}

export function createDashboardAuthorizationContext(input: {
  userId: string; role: Role; organizationId: string; tenantId: string;
}): DashboardAuthorizationContext {
  return {
    actorId: input.userId,
    subjectId: input.userId,
    role: input.role,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    capabilities: ([
      "organization:read", "organization:manage", "member:manage", "patient:read",
      "patient:manage", "clinical:review", "medicine:read", "medicine:manage",
      "prescription:read", "prescription:create", "inventory:read", "inventory:manage",
      "reservation:read", "reservation:create", "reservation:manage", "reservation:credential",
      "payment:read", "payment:create", "mar:read", "mar:create", "mar:transition",
      "assistant:use", "partner:read", "partner:apply", "partner:review", "partner:manage",
    ] as const).filter((permission) => can(input.role, permission)),
    testAsAvailable: false,
  };
}

const widget = (id: string, title: string, requiredPermission: Permission, scope: DataScope, refreshSeconds: number): DashboardWidget => ({
  id, title, requiredPermission, scope, refreshSeconds,
  dataSource: `/api/v1/dashboard/widgets/${id}`,
  fields: ["count", "status", "updatedAt"],
  drillDown: `/control-center/${id}`,
});

const catalog = widget("catalog", "Catalog intelligence", "medicine:read", "all_organization", 900);
const inventory = widget("inventory", "Inventory health", "inventory:read", "selected_locations", 120);
const reservations = widget("reservations", "Reservation queue", "reservation:read", "selected_locations", 30);
const prescriptions = widget("prescriptions", "Prescription activity", "prescription:read", "own_records", 60);
const organizations = widget("organizations", "Organization access", "organization:read", "all_organization", 300);
const patients = widget("patients", "Patient workspace", "patient:read", "own_records", 120);

const candidates: readonly DashboardWidget[] = [catalog, inventory, reservations, prescriptions, organizations, patients];

export function composeDashboard(role: Role): DashboardDefinition {
  const widgets = candidates.filter(({ requiredPermission }) => can(role, requiredPermission));
  return { persona: role, navigation: widgets.map(({ id }) => id), widgets };
}

const accessRank: Readonly<Record<FieldAccess, number>> = { hidden: 0, masked: 1, read_only: 2, editable: 3 };

export function resolveFieldAccess(...rules: readonly FieldAccess[]): FieldAccess {
  if (rules.length === 0) return "hidden";
  return rules.reduce((mostRestrictive, rule) => accessRank[rule] < accessRank[mostRestrictive] ? rule : mostRestrictive);
}

export function serializeAuthorizedFields<T extends Record<string, unknown>>(
  record: T,
  access: Readonly<Partial<Record<keyof T, FieldAccess>>>,
): Partial<T> {
  return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => {
    const state = access[key as keyof T] ?? "hidden";
    if (state === "hidden") return [];
    return [[key, state === "masked" ? "***" : value]];
  })) as Partial<T>;
}

export function authorizeMutationFields<T extends string>(fields: readonly T[], access: Readonly<Partial<Record<T, FieldAccess>>>): void {
  const denied = fields.filter((field) => access[field] !== "editable");
  if (denied.length) throw new Error(`Fields are not editable: ${denied.join(", ")}`);
}

export const nonDelegableCapabilities = [
  "platform_admin", "cross_tenant_access", "migration_administration",
  "service_role_operations", "global_security_configuration",
  "platform_test_as", "global_settlement_administration",
] as const;

export type EvidenceState = "pass" | "fail" | "unknown" | "stale";
export interface ReleaseEvidence { readonly state: Exclude<EvidenceState, "stale">; readonly observedAt?: string; readonly source?: string; }

export function resolveEvidenceFreshness(evidence: ReleaseEvidence | undefined, maxAgeMs: number, now = new Date()): EvidenceState {
  if (!evidence?.observedAt) return "unknown";
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observed) || observed > now.getTime() || now.getTime() - observed > maxAgeMs) return "stale";
  return evidence.state;
}

export interface WorkQueueCondition { readonly id: string; readonly active: boolean; readonly severity: "info" | "warning" | "critical"; readonly title: string; readonly reason: string; readonly href: string; }
export function activeWorkQueue(conditions: readonly WorkQueueCondition[]) {
  return conditions.filter(({ active }) => active).map(({ id, severity, title, reason, href }) => ({ id, severity, title, reason, href }));
}

export const widgetStates = ["READY", "EMPTY", "ERROR", "UNAUTHORIZED", "NOT_CONFIGURED", "STALE", "LOADING"] as const;
export type WidgetState = (typeof widgetStates)[number];
export interface WidgetEnvelope<T> {
  readonly status: WidgetState;
  readonly data: T | null;
  readonly observedAt: string | null;
  readonly stale: boolean;
  readonly error: { readonly message: string; readonly correlationId?: string } | null;
}

export async function isolateWidget<T>(loader: () => Promise<T>, options: { correlationId?: string; empty?: (data: T) => boolean } = {}): Promise<WidgetEnvelope<T>> {
  try {
    const data = await loader();
    return { status: options.empty?.(data) ? "EMPTY" : "READY", data, observedAt: new Date().toISOString(), stale: false, error: null };
  } catch {
    return { status: "ERROR", data: null, observedAt: null, stale: false, error: { message: "This widget could not be loaded.", ...(options.correlationId ? { correlationId: options.correlationId } : {}) } };
  }
}

export type ReleaseEvidenceKind = "migration_parity" | "build" | "security" | "provider_conformance" | "deployment_contract" | "hosted_e2e" | "catalog_certification" | "pharmacy_availability";
export interface ReleaseObservation {
  readonly kind: ReleaseEvidenceKind;
  readonly state: "PASS" | "FAIL" | "STALE" | "UNKNOWN" | "NOT_CONFIGURED";
  readonly observedAt?: string;
  readonly source?: string;
  readonly commit?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
export interface ReleaseEvidenceProvider { load(kind: ReleaseEvidenceKind): Promise<ReleaseObservation | undefined>; }
export const releaseFreshnessMs: Readonly<Record<ReleaseEvidenceKind, number>> = {
  migration_parity: 60 * 60 * 1000,
  build: 24 * 60 * 60 * 1000,
  security: 24 * 60 * 60 * 1000,
  provider_conformance: 24 * 60 * 60 * 1000,
  deployment_contract: 24 * 60 * 60 * 1000,
  hosted_e2e: 6 * 60 * 60 * 1000,
  catalog_certification: 24 * 60 * 60 * 1000,
  pharmacy_availability: 6 * 60 * 60 * 1000,
};

export function certifyReleaseObservation(observation: ReleaseObservation | undefined, expectedCommit: string | undefined, now = new Date()): ReleaseObservation {
  if (!observation) return { kind: "build", state: "UNKNOWN" };
  if (!observation.observedAt) return observation.state === "NOT_CONFIGURED" ? observation : { ...observation, state: "UNKNOWN" };
  const observed = Date.parse(observation.observedAt);
  if (!Number.isFinite(observed) || observed > now.getTime()) return { ...observation, state: "UNKNOWN", details: { ...observation.details, invalidTimestamp: true } };
  if (expectedCommit && observation.commit && observation.commit !== expectedCommit) return { ...observation, state: "STALE" };
  if (now.getTime() - observed > releaseFreshnessMs[observation.kind]) return { ...observation, state: "STALE" };
  return observation;
}
