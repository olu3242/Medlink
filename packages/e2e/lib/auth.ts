import type { Page } from "@playwright/test";
import { awaitMagicLink } from "./mailpit";

// Drives the real, production sign-in surface: fill the email, submit,
// retrieve the magic link Supabase actually sent (via Mailpit, not a
// bypass), and follow it. No service-role session injection, no fake
// cookies, no direct DB session write -- this is the same path a real
// patient/pharmacist/pharmacy user goes through.
export async function signInWithMagicLink(
  page: Page,
  baseUrl: string,
  mailpitUrl: string,
  email: string,
): Promise<void> {
  await page.goto(`${baseUrl}/auth/sign-in`);
  await page.getByLabel("Email address for sign-in link", { exact: true }).fill(email);
  await page.getByRole("button", { name: /email me a sign-in link/i }).click();
  await page.waitForURL(/sent=true/);

  const magicLink = await awaitMagicLink(mailpitUrl, email);
  const expectedOrigin = new URL(baseUrl).origin;
  await page.goto(magicLink, { waitUntil: "networkidle" });
  await page.waitForURL((url) =>
    url.origin === expectedOrigin
    && url.pathname !== "/auth/callback"
    && !url.searchParams.has("error"),
  );
  await page.waitForLoadState("networkidle");
  const sessionCookies = await page.context().cookies(baseUrl);
  if (!sessionCookies.some(({ name }) => name.includes("auth-token"))) {
    throw new Error("Magic-link callback completed without a Supabase session cookie");
  }
}

export async function signInWithPassword(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/auth/sign-in`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.origin === new URL(baseUrl).origin && url.pathname !== "/auth/sign-in");
  const sessionCookies = await page.context().cookies(baseUrl);
  if (!sessionCookies.some(({ name }) => name.includes("auth-token"))) {
    throw new Error("Password sign-in completed without a Supabase session cookie");
  }
}
