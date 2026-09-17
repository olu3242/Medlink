import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> },
  memberships: [] as Array<{ organization_id: string; role: string }>,
  membershipError: null as null | { message: string }, organizationError: null as null | { message: string },
  organization: { name: "Test organization" } as null | { name: string }, cookie: undefined as string | undefined, pathname: "/patient/medicines?sort=brand",
  queries: [] as Array<[string, string, unknown]>,
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }), headers: async () => ({ get: () => state.pathname }) }));
vi.mock("./supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from: (table: string) => {
    const result = () => Promise.resolve(table === "organization_memberships" ? { data: state.memberships, error: state.membershipError } : { data: state.organization, error: state.organizationError });
    const query = { select: () => query, eq: (column: string, value: unknown) => { state.queries.push([table, column, value]); return query; },
      is: (column: string, value: unknown) => { state.queries.push([table, column, value]); return query; }, maybeSingle: result, then: (resolve: (value: unknown) => unknown) => result().then(resolve) };
    return query;
  },
}) }));
import { requirePersonaAccess } from "./persona-access";
describe("requirePersonaAccess server integration", () => {
  beforeEach(() => {
    state.user = { id: "user", email: "synthetic@example.test", app_metadata: {}, user_metadata: {} };
    state.memberships = [{ organization_id: "own", role: "patient" }]; state.cookie = undefined;
    state.organization = { name: "Test organization" }; state.membershipError = null; state.organizationError = null;
    state.queries = []; state.pathname = "/patient/medicines?sort=brand";
  });
  it("redirects signed-out users with a safe original return path", async () => {
    state.user = null;
    await expect(requirePersonaAccess("patient")).rejects.toThrow("REDIRECT:/auth/sign-in?error=auth_required&next=%2Fpatient%2Fmedicines%3Fsort%3Dbrand");
  });
  it("rejects unsafe middleware return values", async () => {
    state.user = null; state.pathname = "//attacker.test";
    await expect(requirePersonaAccess("patient")).rejects.toThrow("next=%2Fpatient");
  });
  it.each([{ memberships: [] }, { memberships: [{ organization_id: "own", role: "patient" }, { organization_id: "other", role: "pharmacist" }] }])("requires a selection for unresolved memberships", async ({ memberships }) => {
    state.memberships = memberships;
    await expect(requirePersonaAccess("patient")).rejects.toThrow("/auth/workspaces?error=permission_denied");
  });
  it("rejects a cookie for another organization", async () => {
    state.cookie = "foreign";
    await expect(requirePersonaAccess("patient")).rejects.toThrow("/auth/workspaces?error=permission_denied");
  });
  it("does not trust active_tenant_id without a matching membership", async () => {
    state.user!.app_metadata.active_tenant_id = "foreign";
    await expect(requirePersonaAccess("patient")).rejects.toThrow("/auth/workspaces?error=permission_denied");
  });
  it("rejects a role that does not permit the requested persona", async () => {
    state.memberships = [{ organization_id: "own", role: "pharmacist" }];
    await expect(requirePersonaAccess("patient")).rejects.toThrow("permission_denied");
  });
  it("rejects missing organizations and database failures", async () => {
    state.organization = null;
    await expect(requirePersonaAccess("patient")).rejects.toThrow("permission_denied");
    state.organization = { name: "Test organization" }; state.organizationError = { message: "database failure" };
    await expect(requirePersonaAccess("patient")).rejects.toThrow("permission_denied");
    state.membershipError = { message: "database failure" };
    await expect(requirePersonaAccess("patient")).rejects.toThrow("auth_unavailable");
  });
  it("returns the verified identity and excludes deleted records in both queries", async () => {
    expect(await requirePersonaAccess("patient")).toMatchObject({ role: "patient", organizationId: "own" });
    expect(state.queries).toContainEqual(["organization_memberships", "user_id", "user"]);
    expect(state.queries).toContainEqual(["organization_memberships", "deleted_at", null]);
    expect(state.queries).toContainEqual(["organizations", "deleted_at", null]);
  });
});
