import { can } from "./authorization";
import { nonDelegableCapabilities, resolveFieldAccess, type DataScope, type FieldAccess } from "./control-center";
import { permissions, type Permission, type Role } from "./roles";

export interface PermissionSetInput {
  readonly capabilities: readonly string[];
  readonly deniedCapabilities?: readonly string[];
}

export interface EffectiveAccessInput {
  readonly role: Role;
  readonly platformMaximum: readonly Permission[];
  readonly organizationDenied?: readonly Permission[];
  readonly permissionSets?: readonly PermissionSetInput[];
  readonly platformFieldAccess?: Readonly<Record<string, FieldAccess>>;
  readonly organizationFieldAccess?: Readonly<Record<string, FieldAccess>>;
  readonly roleFieldAccess?: Readonly<Record<string, FieldAccess>>;
  readonly scope?: DataScope;
  readonly recordAllowed?: boolean;
}

export interface EffectiveAccessDecision {
  readonly decision: "allow" | "deny";
  readonly capabilities: readonly Permission[];
  readonly scope: DataScope;
  readonly fieldAccess: Readonly<Record<string, FieldAccess>>;
  readonly reasons: readonly string[];
}

const permissionRegistry = new Set<string>(permissions);
const nonDelegable = new Set<string>(nonDelegableCapabilities);

export function validateDelegatedCapabilities(actorRole: Role, capabilities: readonly string[]): void {
  const prohibited = capabilities.filter((capability) => nonDelegable.has(capability));
  if (prohibited.length > 0) {
    throw new Error(`Non-delegable capabilities: ${prohibited.join(", ")}`);
  }
  const unknown = capabilities.filter((capability) => !permissionRegistry.has(capability));
  if (unknown.length > 0) throw new Error(`Unknown capabilities: ${unknown.join(", ")}`);
  const beyondActor = capabilities.filter((capability) => !can(actorRole, capability as Permission));
  if (beyondActor.length > 0) throw new Error(`Capabilities exceed actor authority: ${beyondActor.join(", ")}`);
}

export function resolveEffectiveAccess(input: EffectiveAccessInput): EffectiveAccessDecision {
  const maximum = new Set(input.platformMaximum);
  const organizationDenied = new Set(input.organizationDenied ?? []);
  const deniedBySet = new Set((input.permissionSets ?? []).flatMap((set) => [...(set.deniedCapabilities ?? [])]));
  const delegated = new Set((input.permissionSets ?? []).flatMap((set) => [...set.capabilities]));
  const capabilities = permissions.filter((permission) =>
    maximum.has(permission)
    && can(input.role, permission)
    && !organizationDenied.has(permission)
    && !deniedBySet.has(permission)
    && (delegated.size === 0 || delegated.has(permission)),
  );

  const fields = new Set([
    ...Object.keys(input.platformFieldAccess ?? {}),
    ...Object.keys(input.organizationFieldAccess ?? {}),
    ...Object.keys(input.roleFieldAccess ?? {}),
  ]);
  const fieldAccess = Object.fromEntries([...fields].map((field) => [field, resolveFieldAccess(
    input.platformFieldAccess?.[field] ?? "hidden",
    input.organizationFieldAccess?.[field] ?? "hidden",
    input.roleFieldAccess?.[field] ?? "hidden",
  )]));
  const reasons: string[] = [];
  if (input.recordAllowed === false) reasons.push("record_policy_denied");
  if (capabilities.length === 0) reasons.push("no_effective_capabilities");
  return {
    decision: input.recordAllowed === false || capabilities.length === 0 ? "deny" : "allow",
    capabilities,
    scope: input.scope ?? "own_records",
    fieldAccess,
    reasons,
  };
}

export interface TestAsSessionMetadata {
  readonly actorId: string;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly expiresAt: string;
  readonly status: "active" | "ended" | "revoked";
}

export function authorizeTestAsSession(input: TestAsSessionMetadata, now = new Date()): never {
  const reasons: string[] = [];
  if (input.actorId === input.subjectId) reasons.push("nested_or_self_test_as");
  if (input.status !== "active") reasons.push("session_not_active");
  if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now.getTime()) reasons.push("session_expired");
  throw new Error(`TEST_AS_BACKEND_BLOCKED_BY_ARCHITECTURE${reasons.length ? `: ${reasons.join(",")}` : ""}`);
}
