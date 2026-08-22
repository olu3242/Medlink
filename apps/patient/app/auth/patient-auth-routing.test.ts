import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  rpc: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("../../lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      getUser: mocks.getUser,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      signUp: mocks.signUp,
    },
    rpc: mocks.rpc,
  })),
}));

vi.mock("@medlink/ui", () => ({
  ResetPasswordForm: () => React.createElement("form", { "data-testid": "new-password-form" }),
}));

import { GET as authCallback } from "./callback/route";
import ResetPasswordPage from "./reset-password/page";
import { middleware } from "../../middleware";
import {
  requestPasswordReset,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from "./sign-in/actions";

const redirectError = (location: string) => new Error(`NEXT_REDIRECT:${location}`);

function credentials(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("email", "patient@example.test");
  form.set("password", "correct horse battery staple");
  form.set("confirmPassword", "correct horse battery staple");
  Object.entries(overrides).forEach(([key, value]) => form.set(key, value));
  return form;
}

describe("patient hosted auth routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    vi.stubEnv("NODE_ENV", "production");
    process.env.MEDLINK_APP_URL = "https://patient-preview.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    mocks.redirect.mockImplementation((location: string) => {
      throw redirectError(location);
    });
    mocks.signUp.mockResolvedValue({ data: { user: { identities: [{}] } }, error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
  });

  it("supplies the canonical callback URL for signup confirmation", async () => {
    await expect(signUpWithPassword(credentials())).rejects.toThrow("NEXT_REDIRECT:/auth/sign-up?sent=true");

    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: { emailRedirectTo: "https://patient-preview.example.test/auth/callback" },
    }));
  });

  it("supplies the canonical reset-password callback for recovery", async () => {
    await expect(requestPasswordReset(credentials())).rejects.toThrow("NEXT_REDIRECT:/auth/forgot-password?sent=true");

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "patient@example.test",
      { redirectTo: "https://patient-preview.example.test/auth/callback?next=%2Fauth%2Freset-password" },
    );
  });

  it("rejects an external post-login redirect", async () => {
    await expect(signInWithPassword(credentials({ next: "https://evil.example/steal" })))
      .rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("signs out before redirecting to the canonical sign-in route", async () => {
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/auth/sign-in");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/sign-in");
  });

  it("redirects a protected route to sign-in after logout", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await middleware(new NextRequest("https://patient-preview.example.test/profile"));

    expect(response.headers.get("location")).toBe(
      "https://patient-preview.example.test/auth/sign-in?next=%2Fprofile",
    );
  });

  it("exchanges a callback code and routes to the requested internal page", async () => {
    const response = await authCallback(new NextRequest(
      "https://patient-preview.example.test/auth/callback?code=public-code&next=%2Fprofile",
    ));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("public-code");
    expect(response.headers.get("location")).toBe("https://patient-preview.example.test/profile");
  });

  it("routes an expired confirmation to the controlled resend state", async () => {
    const response = await authCallback(new NextRequest(
      "https://patient-preview.example.test/auth/callback?error=access_denied&error_code=otp_expired",
    ));

    expect(response.headers.get("location")).toBe(
      "https://patient-preview.example.test/auth/sign-up?sent=true&error=confirmation_expired",
    );
  });

  it("routes invalid recovery state to the controlled recovery state", async () => {
    const response = await authCallback(new NextRequest(
      "https://patient-preview.example.test/auth/callback?next=%2Fauth%2Freset-password&error=access_denied",
    ));

    expect(response.headers.get("location")).toBe(
      "https://patient-preview.example.test/auth/forgot-password?error=recovery_expired",
    );
  });

  it("does not permit an external callback destination", async () => {
    const response = await authCallback(new NextRequest(
      "https://patient-preview.example.test/auth/callback?code=public-code&next=https%3A%2F%2Fevil.example%2Fsteal",
    ));

    expect(response.headers.get("location")).toBe("https://patient-preview.example.test/");
  });

  it("requires a session before rendering the new-password form", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const page = await ResetPasswordPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Password reset link expired or invalid");
    expect(html).toContain("Request a new reset link");
    expect(html).not.toContain("data-testid=\"new-password-form\"");
  });

  it("renders the new-password form for an authenticated recovery session", async () => {
    const page = await ResetPasswordPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("data-testid=\"new-password-form\"");
  });
});
