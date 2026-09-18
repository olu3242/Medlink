import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata: Record<string, unknown> },
  memberships: [] as Array<{ organization_id: string; role: string; deleted_at: string | null }>,
  cookie: undefined as string | undefined,
  headers: {} as Record<string, string>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "medlink-workspace" && state.cookie ? { value: state.cookie } : undefined) }),
  headers: async () => ({ get: (name: string) => state.headers[name] ?? null }),
}));
vi.mock("./supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => Promise.resolve(table === "organization_memberships" ? { data: state.memberships } : { data: [] }),
      };
      return query;
    },
  }),
}));

import { resolveRequestContext } from "./request-context";

describe("resolveRequestContext", () => {
  beforeEach(() => {
    state.user = { id: "11111111-1111-1111-1111-111111111111", app_metadata: {} };
    state.memberships = [{ organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: null }];
    state.cookie = undefined;
    state.headers = {};
  });

  it("throws AuthenticationError for an anonymous request", async () => {
    state.user = null;
    await expect(resolveRequestContext()).rejects.toThrow(/authentication/i);
  });

  it("resolves the single active membership when no workspace is requested", async () => {
    await expect(resolveRequestContext()).resolves.toMatchObject({
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      role: "patient",
    });
  });

  it("resolves the workspace-switch cookie's organization when the user has multiple active memberships", async () => {
    state.memberships = [
      { organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: null },
      { organization_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "pharmacist", deleted_at: null },
    ];
    state.cookie = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await expect(resolveRequestContext()).resolves.toMatchObject({
      tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role: "pharmacist",
    });
  });

  it("switches organization when the cookie changes between requests, without needing the header", async () => {
    state.memberships = [
      { organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: null },
      { organization_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "pharmacist", deleted_at: null },
    ];
    state.cookie = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await expect(resolveRequestContext()).resolves.toMatchObject({ tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    state.cookie = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await expect(resolveRequestContext()).resolves.toMatchObject({ tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
  });

  it("rejects a forged workspace cookie naming an organization the user is not a member of", async () => {
    state.cookie = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await expect(resolveRequestContext()).rejects.toThrow(/tenant/i);
  });

  it("rejects a revoked (soft-deleted) membership even when explicitly requested", async () => {
    state.memberships = [{ organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: "2020-01-01T00:00:00Z" }];
    state.cookie = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await expect(resolveRequestContext()).rejects.toThrow(/tenant/i);
  });

  it("rejects when the user has no memberships at all", async () => {
    state.memberships = [];
    await expect(resolveRequestContext()).rejects.toThrow(/tenant/i);
  });

  it("does not auto-pick when the user has multiple active memberships and none is requested", async () => {
    state.memberships = [
      { organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: null },
      { organization_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "pharmacist", deleted_at: null },
    ];
    await expect(resolveRequestContext()).rejects.toThrow(/tenant/i);
  });

  it("prefers the explicit x-medlink-tenant-id header over the workspace cookie", async () => {
    state.memberships = [
      { organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: null },
      { organization_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "pharmacist", deleted_at: null },
    ];
    state.cookie = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    state.headers["x-medlink-tenant-id"] = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await expect(resolveRequestContext()).resolves.toMatchObject({ tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
  });

  it("falls back to app_metadata.active_tenant_id only when no header or cookie is present", async () => {
    state.memberships = [
      { organization_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", role: "patient", deleted_at: null },
      { organization_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "pharmacist", deleted_at: null },
    ];
    state.user!.app_metadata.active_tenant_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await expect(resolveRequestContext()).resolves.toMatchObject({ tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
  });
});
