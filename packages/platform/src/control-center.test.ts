import { describe, expect, it } from "vitest";
import { activeWorkQueue, authorizeMutationFields, certifyReleaseObservation, composeDashboard, createDashboardAuthorizationContext, dashboardFilterSchema, isolateWidget, resolveEvidenceFreshness, resolveFieldAccess, serializeAuthorizedFields, type FieldAccess } from "./control-center";

describe("control-center authorization foundation", () => {
  it("composes navigation and widgets from canonical role permissions", () => {
    const patient = composeDashboard("patient");
    expect(patient.navigation).toContain("catalog");
    expect(patient.navigation).toContain("inventory");
    expect(patient.navigation).not.toContain("organizations");
    expect(composeDashboard("inventory_manager").navigation).toEqual(expect.arrayContaining(["catalog", "inventory", "organizations"]));
    expect(composeDashboard("platform_admin").widgets).toHaveLength(6);
  });

  it("resolves field access by the most restrictive layer", () => {
    expect(resolveFieldAccess("editable", "read_only", "editable")).toBe("read_only");
    expect(resolveFieldAccess("editable", "hidden")).toBe("hidden");
    expect(resolveFieldAccess()).toBe("hidden");
  });

  it("omits and masks fields during server serialization", () => {
    expect(serializeAuthorizedFields(
      { quantity: 4, unitCost: 1200, supplier: "Test Supplier" },
      { quantity: "read_only", unitCost: "hidden", supplier: "masked" },
    )).toEqual({ quantity: 4, supplier: "***" });
  });

  it("rejects crafted mutations to hidden or read-only fields", () => {
    const access: Readonly<Partial<Record<string, FieldAccess>>> = { quantity: "editable", unitCost: "read_only" };
    expect(() => authorizeMutationFields(["quantity"], access)).not.toThrow();
    expect(() => authorizeMutationFields(["unitCost"], access)).toThrow(/unitCost/);
    expect(() => authorizeMutationFields(["supplier"], access)).toThrow(/supplier/);
  });

  it("uses the real authenticated user as actor and subject", () => {
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const context = createDashboardAuthorizationContext({ userId, organizationId, tenantId: organizationId, role: "tenant_admin" });
    expect(context.actorId).toBe(userId);
    expect(context.subjectId).toBe(userId);
    expect(context.capabilities).toContain("organization:manage");
    expect(context.capabilities).not.toContain("partner:manage");
    expect(context.testAsAvailable).toBe(false);
  });

  it("validates bounded dependent dashboard filters", () => {
    expect(dashboardFilterSchema.safeParse({ dateFrom: "2026-08-25", dateTo: "2026-08-24" }).success).toBe(false);
    expect(dashboardFilterSchema.safeParse({ locationId: crypto.randomUUID() }).success).toBe(false);
    expect(dashboardFilterSchema.safeParse({ pharmacyId: crypto.randomUUID(), locationId: crypto.randomUUID(), status: "active" }).success).toBe(true);
    expect(dashboardFilterSchema.safeParse({ status: "active;drop" }).success).toBe(false);
  });

  it("never presents stale release evidence as green", () => {
    const now = new Date("2026-08-25T12:00:00Z");
    expect(resolveEvidenceFreshness({ state: "pass", observedAt: "2026-08-25T11:55:00Z" }, 600_000, now)).toBe("pass");
    expect(resolveEvidenceFreshness({ state: "pass", observedAt: "2026-08-24T11:55:00Z" }, 600_000, now)).toBe("stale");
    expect(resolveEvidenceFreshness(undefined, 600_000, now)).toBe("unknown");
  });

  it("creates work only from real active conditions", () => {
    expect(activeWorkQueue([{ id: "mapping", active: true, severity: "warning", title: "Mapping required", reason: "No mappings", href: "/mappings" }, { id: "drift", active: false, severity: "critical", title: "Migration drift", reason: "Drift", href: "/security" }])).toEqual([{ id: "mapping", severity: "warning", title: "Mapping required", reason: "No mappings", href: "/mappings" }]);
  });

  it("isolates widget failures and never exposes stack traces", async () => {
    const [security, catalog] = await Promise.all([
      isolateWidget(async () => { throw new Error("secret stack detail"); }, { correlationId: "req-1" }),
      isolateWidget(async () => ({ medicines: 8994 })),
    ]);
    expect(security).toMatchObject({ status: "ERROR", data: null, error: { message: "This widget could not be loaded.", correlationId: "req-1" } });
    expect(JSON.stringify(security)).not.toContain("secret stack detail");
    expect(catalog).toMatchObject({ status: "READY", data: { medicines: 8994 } });
  });

  it("distinguishes empty data from errors", async () => {
    expect(await isolateWidget(async () => [] as string[], { empty: (rows) => rows.length === 0 })).toMatchObject({ status: "EMPTY", data: [] });
  });

  it("rejects future, expired, and wrong-commit release evidence", () => {
    const now = new Date("2026-08-25T12:00:00Z");
    expect(certifyReleaseObservation({ kind: "build", state: "PASS", observedAt: "2026-08-25T12:01:00Z", source: "ci", commit: "abc" }, "abc", now).state).toBe("UNKNOWN");
    expect(certifyReleaseObservation({ kind: "build", state: "PASS", observedAt: "2026-08-23T12:00:00Z", source: "ci", commit: "abc" }, "abc", now).state).toBe("STALE");
    expect(certifyReleaseObservation({ kind: "build", state: "PASS", observedAt: "2026-08-25T11:00:00Z", source: "ci", commit: "old" }, "abc", now).state).toBe("STALE");
    expect(certifyReleaseObservation(undefined, "abc", now).state).toBe("UNKNOWN");
  });
});
