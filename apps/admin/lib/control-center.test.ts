import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

  function recordingDatabase(failingTable?: string) {
    const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
    class Query implements PromiseLike<{
      count: number | null;
      data: unknown[];
      error: { message: string } | null;
    }> {
      constructor(readonly table: string) {}
      private record(operation: string, ...args: unknown[]) { calls.push({ table: this.table, operation, args }); return this; }
      select(...args: unknown[]) { return this.record("select", ...args); }
      is(...args: unknown[]) { return this.record("is", ...args); }
      eq(...args: unknown[]) { return this.record("eq", ...args); }
      neq(...args: unknown[]) { return this.record("neq", ...args); }
      not(...args: unknown[]) { return this.record("not", ...args); }
      gt(...args: unknown[]) { return this.record("gt", ...args); }
      gte(...args: unknown[]) { return this.record("gte", ...args); }
      lt(...args: unknown[]) { return this.record("lt", ...args); }
      lte(...args: unknown[]) { return this.record("lte", ...args); }
      ilike(...args: unknown[]) { return this.record("ilike", ...args); }
      order(...args: unknown[]) { return this.record("order", ...args); }
      limit(...args: unknown[]) { return this.record("limit", ...args); }
      maybeSingle() { this.record("maybeSingle"); return Promise.resolve({ data: { id: "location" }, error: null }); }
      then<TResult1 = { count: number | null; data: unknown[]; error: { message: string } | null }, TResult2 = never>(onfulfilled?: ((value: { count: number | null; data: unknown[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
        const result = this.table === failingTable
          ? { count: null, data: [], error: { message: "query denied" } }
          : { count: 1, data: [], error: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      }
    }
    return { database: { from: (table: string) => new Query(table) }, calls };
  }

  it("derives manufacturer coverage from authenticated-readable medicines without service role", async () => {
    const { database, calls } = recordingDatabase();
    const result = await new ControlCenterService(database as never).load("catalog", runtime("tenant_admin") as never);
    expect(calls.some(({ table }) => table === "merdp_manufacturer_identities")).toBe(false);
    expect("metrics" in result && result.metrics.some(({ id }) => id === "manufacturer-products")).toBe(true);
  });

  it("labels platform metrics as authenticated RLS-visible scope", async () => {
    const { database } = recordingDatabase();
    const result = await new ControlCenterService(database as never).load("platform", runtime("platform_admin") as never);
    expect("metricScope" in result && result.metricScope).toBe("Authenticated RLS-visible scope");
    const first = "metrics" in result ? result.metrics[0] : undefined;
    expect(first && "label" in first ? first.label : undefined).toBe("Visible organizations");
  });

  it("isolates an unavailable platform metric instead of collapsing the dashboard", async () => {
    const { database } = recordingDatabase("medicines");
    const result = await new ControlCenterService(database as never).load("platform", runtime("platform_admin") as never);
    if (!("metrics" in result)) throw new Error("Platform metrics are missing");
    expect(result.metrics.filter(({ id }) => id === "medicines" || id === "active-medicines"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "medicines", value: 0, status: "unknown" }),
        expect.objectContaining({ id: "active-medicines", value: 0, status: "unknown" }),
      ]));
    expect(result.metrics.find(({ id }) => id === "organizations")?.status).toBe("healthy");
  });

  it("applies an authorized location to every inventory query", async () => {
    const { database, calls } = recordingDatabase();
    const organizationId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    await new ControlCenterService(database as never).load("inventory", { ...runtime("inventory_manager"), organizationId, tenantId: organizationId } as never, { pharmacyId: organizationId, locationId, status: "available" });
    const inventorySelects = calls.filter(({ table, operation }) => table === "inventory_batches" && operation === "select").length;
    const locationPredicates = calls.filter(({ table, operation, args }) => table === "inventory_batches" && operation === "eq" && args[0] === "pharmacy_location_id" && args[1] === locationId).length;
    expect(locationPredicates).toBe(inventorySelects);
    expect(calls).toContainEqual({ table: "inventory_batches", operation: "eq", args: ["status", "available"] });
  });

  it("backs the reservations KPI with a real API and page route", async () => {
    const root = join(import.meta.dirname, "..");
    expect(existsSync(join(root, "app/api/v1/dashboard/reservations/route.ts"))).toBe(true);
    expect(existsSync(join(root, "app/control-center/reservations/page.tsx"))).toBe(true);
    const { database } = recordingDatabase();
    const result = await new ControlCenterService(database as never).load("reservations", runtime("pharmacy_owner") as never);
    const first = "metrics" in result ? result.metrics[0] : undefined;
    expect(first && "href" in first ? first.href : undefined).toBe("/control-center/reservations");
  });
});
