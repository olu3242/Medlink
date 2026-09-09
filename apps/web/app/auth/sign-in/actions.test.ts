import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn((destination: string) => { throw new Error(`REDIRECT:${destination}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { signOut: mocks.signOut } })),
}));

import { signOut } from "./actions";

describe("logout security boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates the Supabase session before showing signed-out confirmation", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow("REDIRECT:/auth/sign-in?signed_out=true");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("does not claim successful logout when invalidation fails", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "internal detail" } });
    await expect(signOut()).rejects.toThrow("REDIRECT:/auth/sign-in?error=sign_out_failed");
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
