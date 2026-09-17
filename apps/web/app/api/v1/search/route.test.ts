import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { role: string; tenantId: string },
  matches: [] as Array<{ medicine: { id: string; brandName: string; genericName: string; strength: string; dosageForm: string }; matchedOn: string }>,
  permissions: new Set(["medicine:read"]),
}));

// A lightweight stand-in for @medlink/api's runApi, mirroring its actual contract
// (schema -> input -> authenticate -> authorize -> execute -> success) closely enough
// to exercise this route's own wiring. runApi's own auth/tenant/permission resolution
// is unit-tested at the package level (packages/api/src/index.test.ts); this fake only
// stands in for that already-covered behavior so this route's logic can be verified
// in isolation.
vi.mock("@medlink/api", () => ({
  runApi: async (request: Request, operation: {
    permission: string;
    schema: { parse(value: unknown): unknown };
    input(request: Request): Promise<unknown>;
    execute(input: unknown, context: unknown, database: unknown): Promise<unknown>;
    success?(output: unknown): Response;
  }) => {
    if (!state.session) {
      return Response.json({ code: "authentication_required" }, { status: 401 });
    }
    if (!state.permissions.has(operation.permission)) {
      return Response.json({ code: "permission_denied" }, { status: 403 });
    }
    const input = operation.schema.parse(await operation.input(request));
    const context = { role: state.session.role, tenantId: state.session.tenantId, organizationId: state.session.tenantId, userId: "user" };
    const output = await operation.execute(input, context, {});
    return operation.success ? operation.success(output) : Response.json({ data: output });
  },
}));
vi.mock("../../../../lib/admin/application", () => ({
  CatalogApplication: class {
    async search() {
      return { matches: state.matches };
    }
  },
}));

import { GET } from "./route";

function request(query: string, extraParams = "") {
  return new Request(`https://medlink.example/api/v1/search?q=${encodeURIComponent(query)}${extraParams}`);
}

describe("GET /api/v1/search", () => {
  beforeEach(() => {
    state.session = null;
    state.matches = [];
    state.permissions = new Set(["medicine:read"]);
  });

  it("denies an anonymous request with a 401", async () => {
    const response = await GET(request("amoxicillin"));
    expect(response.status).toBe(401);
  });

  it("denies a session without medicine:read with a 403", async () => {
    state.session = { role: "patient", tenantId: "org-a" };
    state.permissions = new Set();
    const response = await GET(request("amoxicillin"));
    expect(response.status).toBe(403);
  });

  it("returns an empty result for a query shorter than 2 characters without calling the catalog", async () => {
    state.session = { role: "patient", tenantId: "org-a" };
    const response = await GET(request("a"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.medicines).toEqual([]);
  });

  it("returns canonical catalogue matches for an authorized session, regardless of which persona", async () => {
    state.session = { role: "provider", tenantId: "org-a" };
    state.matches = [{
      medicine: { id: "med-1", brandName: "Augmentin 625", genericName: "Amoxicillin/Clavulanate", strength: "625mg", dosageForm: "tablet" },
      matchedOn: "brand",
    }];
    const response = await GET(request("augmentin"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.medicines).toEqual([{
      id: "med-1", brandName: "Augmentin 625", genericName: "Amoxicillin/Clavulanate",
      strength: "625mg", dosageForm: "tablet", matchedOn: "brand",
    }]);
  });

  it("never leaks a service-role secret or raw database rows -- only the projected fields", async () => {
    state.session = { role: "patient", tenantId: "org-a" };
    state.matches = [{
      medicine: { id: "med-2", brandName: "Panadol", genericName: "Paracetamol", strength: "500mg", dosageForm: "tablet" },
      matchedOn: "generic",
    }];
    const response = await GET(request("panadol"));
    const body = await response.json();
    expect(Object.keys(body.data.medicines[0]).sort()).toEqual(
      ["brandName", "dosageForm", "genericName", "id", "matchedOn", "strength"].sort(),
    );
  });

  it("ignores a query-string persona/role elevation attempt -- only the resolved session determines authority", async () => {
    state.session = { role: "patient", tenantId: "org-a" };
    state.matches = [{
      medicine: { id: "med-3", brandName: "Amoxil", genericName: "Amoxicillin", strength: "250mg", dosageForm: "capsule" },
      matchedOn: "brand",
    }];
    const elevated = await GET(request("amoxil", "&role=platform_admin&persona=admin&as=admin"));
    const plain = await GET(request("amoxil"));
    expect(await elevated.json()).toEqual(await plain.json());
  });

  it("ignores a cross-tenant organizationId supplied on the query string -- the route's input schema only reads q", async () => {
    state.session = { role: "pharmacist", tenantId: "org-a" };
    state.matches = [];
    const response = await GET(request("panadol", "&organizationId=another-tenant&tenantId=another-tenant"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.medicines).toEqual([]);
  });
});
