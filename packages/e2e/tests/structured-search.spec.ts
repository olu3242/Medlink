import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "../lib/auth";
import { prepareStructuredSearchFixture } from "../lib/structured-search-fixture";

let fixture: Awaited<ReturnType<typeof prepareStructuredSearchFixture>>;
test.beforeAll(async () => { fixture = await prepareStructuredSearchFixture(); });
const base = "http://localhost:3100";

test("signed-out deep links preserve a safe return path and protect APIs", async ({ page }) => {
  await page.goto("/patient/medicines?sort=brand");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/patient/medicines?sort=brand");
  await expect(page.getByRole("heading", { name: "Sign in securely" })).toBeVisible();
  expect((await page.request.get("/patient/api/v1/medicines")).status()).toBe(401);
  await page.goto("/auth/sign-in?next=%2F%5Cevil.test");
  await expect(page.locator('input[name="next"]')).toHaveValue("/");
});

test("live catalogue groups, filters, stock and reviewed reservation entry", async ({ page }) => {
  await signInWithMagicLink(page, base, process.env.MEDLINK_E2E_MAILPIT_URL!, fixture.users.patient!.email, { next: "/patient/medicines" });
  await expect(page.locator('[data-persona="patient"]')).toBeVisible();
  await page.getByLabel("Prescribed brand or generic name").fill("CERT Combination");
  await page.getByRole("button", { name: "Find prescribed product" }).click();
  await page.getByLabel("Product", { exact: true }).selectOption(fixture.products.reference!);
  for (const group of ["Exact pharmaceutical matches", "Related formulations", "Therapeutic alternatives"]) await expect(page.getByRole("region", { name: group })).toBeVisible();
  await expect(page.getByText("Source: internal medicine catalogue.", { exact: false })).toBeVisible();
  await expect(page.getByText("Not an exact match: ingredient amounts or ratios", { exact: false }).first()).toBeVisible();
  await page.getByLabel("Match quality").selectOption("exact");
  await page.getByLabel("Brand", { exact: true }).selectOption("CERT Combination");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText("Location selected.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("heading", { name: "CERT Pharmacy 1", exact: true })).toBeVisible();
  await expect(page.getByText("Availability unconfirmed", { exact: false })).toBeVisible();
  await page.getByLabel("Availability", { exact: true }).selectOption("in_stock");
  await page.getByLabel("Sort within each safety group").selectOption("price");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("heading", { name: "CERT Pharmacy 3", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Call", exact: true }).first()).toHaveAttribute("href", /^tel:/);
  await page.screenshot({ path: test.info().outputPath("catalogue.png"), fullPage: true });
  await page.getByRole("link", { name: "Reserve — start medication request" }).first().click();
  await expect(page.getByRole("heading", { name: "Add a prescription" })).toBeVisible();
  await expect(page.getByText("A pharmacist reviews", { exact: false })).toBeVisible();
});

test("wrong portal, invalid workspace selection, logout and browser history", async ({ page, context }) => {
  await signInWithMagicLink(page, base, process.env.MEDLINK_E2E_MAILPIT_URL!, fixture.users.patient!.email, { next: "/patient/medicines" });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/auth\/workspaces\?error=permission_denied/);
  await expect(page.getByText("You do not have access to this workspace.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/patient$/);
  const workspace = (await context.cookies()).find((cookie) => cookie.name === "medlink-workspace");
  expect(workspace?.httpOnly).toBe(true); expect(workspace?.sameSite).toBe("Lax");
  await context.addCookies([{ name: "medlink-workspace", value: fixture.pharmacyOrganizationId, domain: "localhost", path: "/", httpOnly: true }]);
  await page.goto("/patient/medicines");
  await expect(page).toHaveURL(/\/auth\/workspaces/);
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/signed_out=true/);
  expect((await context.cookies()).some((cookie) => cookie.name === "medlink-workspace")).toBe(false);
  expect((await page.request.get("/patient/api/v1/medicines")).status()).toBe(401);
  await page.goBack();
  await expect(page.locator('[data-persona="patient"]')).toHaveCount(0);
});
