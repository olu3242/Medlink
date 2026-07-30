import { describe, expect, it, vi } from "vitest";
import { EnterpriseAdministrationService } from "./enterprise-administration";

const tenantId = "10000000-0000-4000-8000-000000000001";
const context = {
  correlationId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  tenantId,
  role: "tenant_admin" as const,
};

describe("enterprise administration", () => {
  it("audits an authorized tenant-scoped action", async () => {
    const append = vi.fn();
    const service = new EnterpriseAdministrationService(
      { append },
      () => new Date("2026-07-30T00:00:00Z"),
    );
    await service.apply(context, {
      id: "change-1",
      tenantId,
      resource: "pharmacy",
      resourceId: "pharmacy-1",
      operation: "update",
      changes: { enabled: true },
    });
    expect(append).toHaveBeenCalledOnce();
  });

  it("denies cross-tenant and unapproved privileged actions", async () => {
    const service = new EnterpriseAdministrationService(
      { append: vi.fn() },
      () => new Date(),
    );
    await expect(service.apply(context, {
      id: "change-2",
      tenantId: "10000000-0000-4000-8000-000000000002",
      resource: "pharmacy",
      resourceId: "pharmacy-2",
      operation: "update",
      changes: { enabled: true },
    })).rejects.toThrow(/Cross-tenant/);
    await expect(service.apply(context, {
      id: "change-3",
      tenantId,
      resource: "certificate",
      resourceId: "cert-1",
      operation: "rotate",
      changes: { version: "2" },
    })).rejects.toThrow(/approval evidence/);
  });
});
