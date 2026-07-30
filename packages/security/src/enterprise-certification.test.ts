import { describe, expect, it } from "vitest";
import {
  certifyEnterpriseSecurity,
  type SecurityControl,
} from "./enterprise-certification";

describe("enterprise security certification", () => {
  const controls: readonly SecurityControl[] = [
    "owasp_top_10", "sql_injection", "xss", "csrf", "ssrf", "jwt",
    "session_integrity", "rbac", "tenant_escape", "api_authorization",
    "secret_scanning", "dependency_scanning", "container_scanning", "sbom",
    "license_compliance",
  ];

  it("requires every hashed control artifact and no unresolved critical finding", () => {
    const result = certifyEnterpriseSecurity(
      controls.map((control) => ({
        control,
        passed: true,
        artifactSha256: "a".repeat(64),
      })),
      [{ id: "fixed", severity: "critical", resolved: true }],
    );
    expect(result.passed).toBe(true);
    expect(result.reports).toContain("sbom.json");
  });

  it("fails closed for missing controls, invalid artifacts, and critical findings", () => {
    const result = certifyEnterpriseSecurity(
      [{ control: "owasp_top_10", passed: true, artifactSha256: "invalid" }],
      [{ id: "CVE-critical", severity: "critical", resolved: false }],
    );
    expect(result.passed).toBe(false);
    expect(result.failed).toContain("owasp_top_10");
    expect(result.missing).toContain("sql_injection");
    expect(result.blockingFindings).toEqual(["CVE-critical"]);
  });
});
