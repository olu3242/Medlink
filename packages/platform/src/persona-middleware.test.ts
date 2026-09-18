import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; app_metadata: Record<string, unknown> },
  memberships: [] as Array<{ organization_id: string; role: string }>,
  membershipError: null as null | { message: string },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        is: () =>
          Promise.resolve(
            table === "organization_memberships"
              ? { data: state.memberships, error: state.membershipError }
              : { data: [], error: null },
          ),
      };
      return query;
    },
  }),
}));

import { enforcePersonaRequest, legacyRetirementRedirect } from "./persona-middleware";

function request(pathname: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `medlink-workspace=${cookie}`);
  return new NextRequest(new URL(pathname, "https://medlink.example"), { headers });
}

describe("enforcePersonaRequest", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    state.user = null;
    state.memberships = [];
    state.membershipError = null;
  });

  it("denies anonymous requests, redirecting to sign-in", async () => {
    const response = await enforcePersonaRequest(request("/patient"), {
      portal: "patient",
      signInPath: "/patient/auth/sign-in",
    });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/patient/auth/sign-in");
    expect(location.searchParams.get("next")).toBe("/patient");
  });

  it("denies a role that does not match the requested persona", async () => {
    state.user = { id: "user-1", app_metadata: {} };
    state.memberships = [{ organization_id: "org-1", role: "pharmacist" }];
    const response = await enforcePersonaRequest(request("/patient"), {
      portal: "patient",
      signInPath: "/patient/auth/sign-in",
    });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/patient/auth/sign-in");
    expect(location.searchParams.get("error")).toBe("forbidden");
  });

  it("allows a valid persona and tags the request with the resolved theme", async () => {
    state.user = { id: "user-1", app_metadata: {} };
    state.memberships = [{ organization_id: "org-1", role: "patient" }];
    const response = await enforcePersonaRequest(request("/patient"), {
      portal: "patient",
      signInPath: "/patient/auth/sign-in",
    });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-medlink-persona-theme")).toBe("patient");
  });

  it("denies when the active workspace cookie does not match any membership", async () => {
    state.user = { id: "user-1", app_metadata: {} };
    state.memberships = [{ organization_id: "org-1", role: "patient" }];
    const response = await enforcePersonaRequest(request("/patient", "org-2"), {
      portal: "patient",
      signInPath: "/patient/auth/sign-in",
    });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("forbidden");
  });

  it("fails closed when the membership query errors", async () => {
    state.user = { id: "user-1", app_metadata: {} };
    state.membershipError = { message: "database unavailable" };
    const response = await enforcePersonaRequest(request("/patient"), {
      portal: "patient",
      signInPath: "/patient/auth/sign-in",
    });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("forbidden");
  });
});

describe("legacyRetirementRedirect", () => {
  it("is a no-op with no canonical origin configured -- retirement redirect is opt-in per deployment", () => {
    expect(legacyRetirementRedirect(request("/medicines"), { portal: "patient", canonicalOrigin: undefined })).toBeNull();
  });

  it("never redirects an auth route, even with a canonical origin configured", () => {
    expect(legacyRetirementRedirect(request("/auth/sign-in"), { portal: "patient", canonicalOrigin: "https://canonical.example" })).toBeNull();
    expect(legacyRetirementRedirect(request("/auth/callback"), { portal: "patient", canonicalOrigin: "https://canonical.example" })).toBeNull();
  });

  it("never redirects an api route, even with a canonical origin configured", () => {
    expect(legacyRetirementRedirect(request("/api/v1/medicines/search"), { portal: "patient", canonicalOrigin: "https://canonical.example" })).toBeNull();
  });

  it("redirects the root to the canonical persona home", () => {
    const response = legacyRetirementRedirect(request("/"), { portal: "patient", canonicalOrigin: "https://canonical.example" });
    expect(response?.status).toBe(307);
    expect(new URL(response!.headers.get("location")!).pathname).toBe("/patient");
  });

  it("redirects a native root-relative page path to its canonical persona-prefixed equivalent", () => {
    const response = legacyRetirementRedirect(request("/medicines/med-1"), { portal: "patient", canonicalOrigin: "https://canonical.example" });
    const location = new URL(response!.headers.get("location")!);
    expect(location.origin).toBe("https://canonical.example");
    expect(location.pathname).toBe("/patient/medicines/med-1");
  });

  it("does not double-prefix a path the standalone app's own rewrite already serves under /{portal}", () => {
    const response = legacyRetirementRedirect(request("/patient/medicines"), { portal: "patient", canonicalOrigin: "https://canonical.example" });
    expect(new URL(response!.headers.get("location")!).pathname).toBe("/patient/medicines");
  });

  it("preserves the query string", () => {
    const response = legacyRetirementRedirect(request("/search?q=amoxicillin"), { portal: "patient", canonicalOrigin: "https://canonical.example" });
    const location = new URL(response!.headers.get("location")!);
    expect(location.pathname).toBe("/patient/search");
    expect(location.searchParams.get("q")).toBe("amoxicillin");
  });
});
