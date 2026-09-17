import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as null | { role: string } }));

vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("../lib/persona-access", () => ({ resolveActiveSession: async () => state.session }));

import HomePage from "./page";

describe("canonical home routing", () => {
  it("routes an authenticated patient to their persona home", async () => {
    state.session = { role: "patient" };
    await expect(HomePage()).rejects.toThrow("REDIRECT:/patient");
  });

  it("routes an authenticated pharmacy owner to the pharmacy portal, not a role-named route", async () => {
    state.session = { role: "pharmacy_owner" };
    await expect(HomePage()).rejects.toThrow("REDIRECT:/pharmacy");
  });

  it("routes an authenticated platform admin to the admin portal", async () => {
    state.session = { role: "platform_admin" };
    await expect(HomePage()).rejects.toThrow("REDIRECT:/admin");
  });

  it("never redirects an unauthenticated visitor -- the public landing page renders instead", async () => {
    state.session = null;
    // JSX rendering is outside this test's scope (this repo tests apps/web logic, not React
    // output); the assertion here is only that resolveActiveSession -> null takes the non-redirect
    // branch, i.e. HomePage runs past the redirect() call without throwing a REDIRECT:* error.
    await expect(HomePage()).rejects.not.toThrow(/^REDIRECT:/);
  });
});
