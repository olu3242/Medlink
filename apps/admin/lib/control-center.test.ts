import { describe, expect, it } from "vitest";
import { ControlCenterService } from "./control-center";

const runtime = (role: string) => ({
  correlationId: crypto.randomUUID(), requestId: crypto.randomUUID(),
  userId: crypto.randomUUID(), tenantId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(), role,
});

describe("ControlCenterService authorization", () => {
  const service = new ControlCenterService({} as never);

  it("denies patients before any dashboard query", async () => {
    await expect(service.load("catalog", runtime("patient") as never)).rejects.toMatchObject({ status: 403 });
  });

  it("denies pharmacy owners access to platform security", async () => {
    await expect(service.load("security", runtime("pharmacy_owner") as never)).rejects.toMatchObject({ status: 403 });
  });

  it("reports unavailable release evidence as unknown instead of fabricating status", async () => {
    const result = await service.load("security", runtime("platform_admin") as never);
    expect(result.authorization.actorId).toBe(result.authorization.subjectId);
    expect(result.authorization.testAsAvailable).toBe(false);
    expect("metrics" in result).toBe(true);
    if (!("metrics" in result)) throw new Error("Security metrics are missing");
    expect(result.metrics).toHaveLength(7);
    expect(result.metrics.every((item) => item.status === "unknown")).toBe(true);
  });

  it("denies tenant-expanding organization and pharmacy filters before querying", async () => {
    await expect(service.load("organizations", runtime("tenant_admin") as never, { organizationId: crypto.randomUUID() })).rejects.toMatchObject({ status: 403 });
    await expect(service.load("inventory", runtime("inventory_manager") as never, { pharmacyId: crypto.randomUUID() })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects inconsistent organization and pharmacy dependencies", async () => {
    await expect(service.load("organizations", runtime("platform_admin") as never, { organizationId: crypto.randomUUID(), pharmacyId: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 });
  });
});
