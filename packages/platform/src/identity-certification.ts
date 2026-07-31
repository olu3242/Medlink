export type TenantLifecycle = "provisioning" | "verified" | "active" | "suspended";
export type IdentityKind =
  | "pharmacist"
  | "provider"
  | "patient"
  | "service_account"
  | "api_client"
  | "device";

export interface IdentityEvidence {
  readonly subjectId: string;
  readonly kind: IdentityKind;
  readonly verified: boolean;
  readonly trustedClient: boolean;
  readonly expiresAt?: Date;
}

export interface IdentityCertificationInput {
  readonly tenantId: string;
  readonly lifecycle: TenantLifecycle;
  readonly ownershipVerified: boolean;
  readonly jwtValidated: boolean;
  readonly sessionValidated: boolean;
  readonly requiredIdentityKinds: readonly IdentityKind[];
  readonly identities: readonly IdentityEvidence[];
  readonly evaluatedAt: Date;
}

export interface IdentityCertificationResult {
  readonly passed: boolean;
  readonly checks: Readonly<Record<
    "tenantIsolation" | "identity" | "jwt" | "session",
    boolean
  >>;
  readonly failures: readonly string[];
}

export function certifyIdentity(
  input: IdentityCertificationInput,
): IdentityCertificationResult {
  const current = input.identities.filter(
    (identity) => !identity.expiresAt || identity.expiresAt > input.evaluatedAt,
  );
  const uniqueSubjects = new Set(current.map(({ subjectId }) => subjectId));
  const requiredPresent = input.requiredIdentityKinds.every((kind) =>
    current.some((identity) =>
      identity.kind === kind && identity.verified && identity.trustedClient
    ),
  );
  const checks = {
    tenantIsolation: input.lifecycle === "active" && input.ownershipVerified,
    identity:
      current.length === input.identities.length
      && uniqueSubjects.size === current.length
      && requiredPresent,
    jwt: input.jwtValidated,
    session: input.sessionValidated,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return { passed: failures.length === 0, checks, failures };
}

const lifecycleTransitions: Readonly<Record<TenantLifecycle, readonly TenantLifecycle[]>> = {
  provisioning: ["verified"],
  verified: ["active", "suspended"],
  active: ["suspended"],
  suspended: ["active"],
};

export function canTransitionTenant(
  from: TenantLifecycle,
  to: TenantLifecycle,
): boolean {
  return lifecycleTransitions[from].includes(to);
}
