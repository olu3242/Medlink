import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeRuntimeContext, requestDatabase } from "./index";

describe("authorizeRuntimeContext", () => {
  it("maps a role denial to a sanitized forbidden runtime error", () => {
    expect(() => authorizeRuntimeContext(
      { role: "patient" },
      "reservation:manage",
    )).toThrow(expect.objectContaining({
      category: "authorization",
      code: "permission_denied",
      message: "You do not have permission to perform this action",
      status: 403,
    }));
  });

  it("allows a registered permission assigned to the role", () => {
    expect(() => authorizeRuntimeContext(
      { role: "patient" },
      "reservation:create",
    )).not.toThrow();
  });
});

// packages/api previously had zero tests despite being the canonical
// pipeline apps/admin and apps/patient route every request through
// (docs/audit/RC1_SPRINT_REPORT.md flagged this as a real gap). Full
// authenticate() coverage needs a live Supabase instance (it calls
// database.auth.getUser() and queries organization_memberships over the
// network) - not available in this sandbox, see Phase 1 in the sprint
// report. requestDatabase() is the pure, deterministic part: it validates
// required env vars and forwards the caller's Authorization header onto a
// fresh Supabase client, both testable without a network call.
describe("requestDatabase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards the request's Authorization header onto the Supabase client", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const request = new Request("https://medlink.example/api/v1/medicines", {
      headers: { Authorization: "Bearer patient-session-token" },
    });
    const database = requestDatabase(request);

    expect((database as unknown as { rest: { headers: Headers } }).rest.headers.get("Authorization"))
      .toBe("Bearer patient-session-token");
  });

  it("does not force an empty Authorization when the request has none, so a cookie-derived session can still authenticate data queries", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    // A browser-originated request never sends an Authorization header --
    // only a cookie. Forcing Authorization: "" here used to silently
    // disable @supabase/ssr's own per-request attachment of the session's
    // access token, downgrading every .from()/.rpc() call to the "anon"
    // Postgres role even for a signed-in user. Leaving the header entirely
    // absent lets the client attach the real session token itself.
    const request = new Request("https://medlink.example/api/v1/medicines");
    const database = requestDatabase(request);

    expect((database as unknown as { rest: { headers: Headers } }).rest.headers.get("Authorization"))
      .toBeNull();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing or not a URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const request = new Request("https://medlink.example/api/v1/medicines");
    expect(() => requestDatabase(request)).toThrow();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const request = new Request("https://medlink.example/api/v1/medicines");
    expect(() => requestDatabase(request)).toThrow();
  });
});
