import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures/certification-test";
import { signInWithPassword } from "../lib/auth";
import type { AuthE2EFixture } from "../lib/fixture";
import { awaitMagicLink } from "../lib/mailpit";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const webUrl = process.env.MEDLINK_E2E_WEB_URL ?? "http://localhost:3004";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

async function fixture() {
  return JSON.parse(await readFile(new URL("../.fixture.json", import.meta.url), "utf8")) as AuthE2EFixture;
}

test("MED-AUTH-001 visible signup verifies once, bootstraps patient, and supports return password login", async ({ page }) => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const email = `password-signup-${nonce}@medlink.test`;
  const password = `MedLink-Signup-${nonce}!9`;

  await page.goto(`${patientUrl}/auth/sign-up`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  const passwordInput = page.getByLabel("Password", { exact: true });
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up\?sent=true/);
  await expect(page.getByRole("status")).toContainText("verification email");

  await page.goto(`${patientUrl}/auth/sign-in`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/error=email_unverified/);
  await expect(page.locator(".error[role=alert]")).toHaveText("Verify your email before signing in.");

  const verificationLink = await awaitMagicLink(mailpitUrl, email);
  await page.goto(verificationLink, { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.origin === new URL(patientUrl).origin && url.pathname === "/");
  expect((await page.context().cookies(patientUrl)).some(({ name }) => name.includes("auth-token"))).toBe(true);
  expect((await page.request.get(`${patientUrl}/api/v1/mar`)).status()).toBe(200);

  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/auth\/sign-in$/);
  await signInWithPassword(page, patientUrl, email, password);
  await page.reload();
  expect((await page.request.get(`${patientUrl}/api/v1/mar`)).status()).toBe(200);
});

test("MED-AUTH-002 existing OTP-only identity sets a password without duplication", async ({ page }) => {
  const authFixture = await fixture();
  const existing = authFixture.partnerApplicant;
  const password = `MedLink-Migrated-${Date.now().toString(36)}!9`;

  await page.goto(`${webUrl}/auth/forgot-password`);
  await page.getByLabel("Email address", { exact: true }).fill(existing.email);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page).toHaveURL(/sent=true/);
  const recoveryLink = await awaitMagicLink(mailpitUrl, existing.email);
  await page.goto(recoveryLink, { waitUntil: "networkidle" });
  await page.waitForURL((url) => url.origin === new URL(webUrl).origin && url.pathname === "/auth/reset-password");
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in\?password_updated=true/);
  await signInWithPassword(page, webUrl, existing.email, password);

  const supabaseUrl = process.env.MEDLINK_E2E_SUPABASE_URL;
  const serviceKey = process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase E2E service configuration is required");
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await service.auth.signInWithPassword({ email: existing.email, password });
  if (error) throw error;
  expect(data.user.id).toBe(existing.userId);
  expect(data.user.email).toBe(existing.email);
});
