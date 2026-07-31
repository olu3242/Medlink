import { describe, expect, it } from "vitest";
import { projectEnterpriseDashboard } from "./enterprise-dashboards";

const context = {
  correlationId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  tenantId: "10000000-0000-4000-8000-000000000001",
  role: "tenant_admin" as const,
};

describe("enterprise dashboards", () => {
  it("filters operational data to the caller tenant", () => {
    const result = projectEnterpriseDashboard(context, "operations", [{
      tenantId: context.tenantId,
      dashboard: "operations",
      name: "availability",
      current: 99.9,
      history: [99.8],
      evidenceSha256: "d".repeat(64),
    }, {
      tenantId: "another-tenant",
      dashboard: "operations",
      name: "availability",
      current: 90,
      history: [89],
      evidenceSha256: "d".repeat(64),
    }]);
    expect(result).toHaveLength(1);
  });

  it("restricts enterprise dashboards", () => {
    expect(() => projectEnterpriseDashboard(context, "executive", [])).toThrow(
      /Platform administration/,
    );
  });
});
