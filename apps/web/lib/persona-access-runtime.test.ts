import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: null } })),
  redirect: vi.fn((destination: string) => { throw new Error(`REDIRECT:${destination}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

import { requirePersonaAccess } from "./persona-access";

describe("protected route authentication boundary", () => {
  it("denies a protected workspace after its session is absent", async () => {
    await expect(requirePersonaAccess("admin")).rejects.toThrow("REDIRECT:/auth/sign-in?error=auth_required&next=/admin");
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});
