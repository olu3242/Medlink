import { describe, expect, it } from "vitest";
import {
  deriveReadinessDashboard,
  type ReadinessDomain,
} from "./readiness-dashboard";

describe("production readiness dashboard", () => {
  const domains: readonly ReadinessDomain[] = [
    "runtime", "database", "live_supabase", "hosted_rls", "identity",
    "tenant_isolation", "security", "penetration_testing", "observability",
    "incident_management", "clinical_safety", "compliance", "backup",
    "disaster_recovery", "providers", "release_governance", "human_approvals",
  ];
  const now = new Date("2026-07-30T00:00:00Z");
  const gates = domains.map((domain) => ({
    domain,
    mandatory: true,
    status: "pass" as const,
    evidenceSha256: "a".repeat(64),
    expiresAt: new Date("2026-08-30T00:00:00Z"),
  }));

  it("authorizes Wave 2.5 only when every mandatory domain is current", () => {
    expect(deriveReadinessDashboard(gates, now)).toMatchObject({
      status: "enterprise_certified",
      deployment: "allowed",
      wave25Admission: "eligible",
    });
  });

  it("degrades immediately and identifies failed or missing domains", () => {
    const result = deriveReadinessDashboard(
      gates.filter(({ domain }) => domain !== "providers").map((gate) =>
        gate.domain === "security" ? { ...gate, status: "fail" as const } : gate
      ),
      now,
    );
    expect(result).toMatchObject({
      status: "certification_degraded",
      deployment: "blocked",
      wave25Admission: "blocked",
      failingDomains: ["security"],
      missingDomains: ["providers"],
    });
  });
});
