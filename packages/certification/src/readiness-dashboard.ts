export type ReadinessDomain =
  | "runtime" | "database" | "live_supabase" | "hosted_rls" | "identity"
  | "tenant_isolation" | "security" | "penetration_testing" | "observability"
  | "incident_management" | "clinical_safety" | "compliance" | "backup"
  | "disaster_recovery" | "providers" | "release_governance"
  | "human_approvals";

export interface ReadinessGate {
  readonly domain: ReadinessDomain;
  readonly mandatory: boolean;
  readonly status: "pass" | "fail" | "conditional";
  readonly evidenceSha256: string;
  readonly expiresAt: Date;
}

export function deriveReadinessDashboard(
  gates: readonly ReadinessGate[],
  now: Date,
): {
  readonly status: "enterprise_certified" | "certification_degraded";
  readonly deployment: "allowed" | "blocked";
  readonly wave25Admission: "eligible" | "blocked";
  readonly failingDomains: readonly ReadinessDomain[];
  readonly missingDomains: readonly ReadinessDomain[];
} {
  const required: readonly ReadinessDomain[] = [
    "runtime", "database", "live_supabase", "hosted_rls", "identity",
    "tenant_isolation", "security", "penetration_testing", "observability",
    "incident_management", "clinical_safety", "compliance", "backup",
    "disaster_recovery", "providers", "release_governance", "human_approvals",
  ];
  const missingDomains = required.filter((domain) =>
    !gates.some((gate) => gate.domain === domain && gate.mandatory)
  );
  const failingDomains = required.filter((domain) => {
    const gate = gates.find((item) => item.domain === domain && item.mandatory);
    return Boolean(
      gate
      && (
        gate.status !== "pass"
        || gate.expiresAt <= now
        || !/^[a-f0-9]{64}$/i.test(gate.evidenceSha256)
      )
    );
  });
  const passed = missingDomains.length === 0 && failingDomains.length === 0;
  return {
    status: passed ? "enterprise_certified" : "certification_degraded",
    deployment: passed ? "allowed" : "blocked",
    wave25Admission: passed ? "eligible" : "blocked",
    failingDomains,
    missingDomains,
  };
}
