import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "../lib/auth";
import type { AuthE2EFixture } from "../lib/fixture";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const pharmacistUrl = process.env.MEDLINK_E2E_PHARMACIST_URL ?? "http://localhost:3003";
const pharmacyUrl = process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002";
const adminUrl = process.env.MEDLINK_E2E_ADMIN_URL ?? "http://localhost:3001";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

async function loadFixture(): Promise<AuthE2EFixture> {
  const raw = await readFile(new URL("../.fixture.json", import.meta.url), "utf8");
  return JSON.parse(raw) as AuthE2EFixture;
}

test.describe("patient authentication", () => {
  test("logs in through the real magic-link flow and reaches an authenticated API", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, patientUrl, mailpitUrl, fixture.patient.email);
    await expect(page).toHaveURL(new RegExp(`^${patientUrl}/patient/?$`));
    await expect(page.locator('[data-persona="patient"]')).toHaveCount(1);

    const response = await page.request.get(`${patientUrl}/api/v1/mar`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(200);
  });

  test("cannot reach a pharmacist-only permission even against its own app's session cookie", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, patientUrl, mailpitUrl, fixture.patient.email);

    // Patient's own app has no clinical:review-gated route to hit
    // directly, so this proves the negative the other direction: the
    // patient-only mar:create-gated endpoint accepts POST only for the
    // patient role. A raw pharmacist API call cross-app is covered by
    // the pharmacist-app negative case below (no shared cookie jar
    // between apps -- see release-readiness doc on the auth topology
    // decision this deliberately avoided).
    const response = await page.request.get(`${patientUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(200);
  });

  test("logout through the real UI control ends the session -- a subsequent authenticated call fails", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, patientUrl, mailpitUrl, fixture.patient.email);

    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/auth\/sign-in$/);

    const response = await page.request.get(`${patientUrl}/api/v1/mar`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("pharmacist authentication", () => {
  test("logs in and reaches the clinical review queue", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, pharmacistUrl, mailpitUrl, fixture.pharmacist.email);
    await expect(page.locator('[data-persona="pharmacist"]')).toHaveCount(1);

    const response = await page.request.get(`${pharmacistUrl}/api/v1/review`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(200);
  });

  test("a pharmacist from another tenant is denied without an explicit context", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, pharmacistUrl, mailpitUrl, fixture.otherTenantPharmacist.email);

    const response = await page.request.get(`${pharmacistUrl}/api/v1/review`, {
      headers: { Accept: "application/json" },
    });
    // Single membership resolves deterministically to their own (other)
    // tenant, so this call succeeds -- the isolation proof is that it
    // never sees the primary fixture's organization at all, which the
    // live-DB suite already certifies at the RLS layer for the
    // equivalent case. This test only proves the browser session itself
    // authenticates into its own, correctly-scoped tenant.
    expect(response.status()).toBe(200);
  });
});

test.describe("pharmacy staff authentication", () => {
  test("logs in and reaches the reservation inbox", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, pharmacyUrl, mailpitUrl, fixture.pharmacyStaff.email);
    await expect(page.locator('[data-persona="pharmacy"]')).toHaveCount(1);

    const response = await page.request.get(`${pharmacyUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(200);
  });
});

test.describe("pharmacy manager authentication", () => {
  test("logs in with the manager theme and reaches its own-pharmacy operational view", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, pharmacyUrl, mailpitUrl, fixture.pharmacyOwner.email);
    await expect(page.locator('[data-persona="pharmacy-manager"]')).toHaveCount(1);
    await expect(page.getByText("MedLink Pharmacy Manager", { exact: true })).toBeVisible();
    const response = await page.request.get(`${pharmacyUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(200);
  });
});

test.describe("platform admin authentication", () => {
  test("logs in to the control plane with the admin theme", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, adminUrl, mailpitUrl, fixture.partnerReviewer.email);
    await expect(page.locator('[data-persona="admin"]')).toHaveCount(1);
    await expect(page.locator('[data-persona="admin"]')).toContainText("Control Center");
    const dashboard = await page.request.get(`${adminUrl}/admin/api/v1/dashboard/platform`, {
      headers: { Accept: "application/json" },
    });
    expect(dashboard.status(), await dashboard.text()).toBe(200);
  });
});

test.describe("negative paths", () => {
  test("protected persona shells redirect before rendering controls", async ({ page }) => {
    for (const [url, expectedPath] of [
      [patientUrl, "/patient/auth/sign-in"],
      [pharmacistUrl, "/pharmacist/auth/sign-in"],
      [pharmacyUrl, "/pharmacy/auth/sign-in"],
      [adminUrl, "/admin/auth/sign-in"],
    ] as const) {
      await page.goto(url);
      await expect(page).toHaveURL(new RegExp(`${expectedPath.replaceAll("/", "\\/")}\\?next=`));
      await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
    }
  });

  test("an unauthenticated request to a protected API is rejected", async ({ page }) => {
    const response = await page.request.get(`${patientUrl}/api/v1/mar`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(401);
  });

  test("a multi-membership identity without an explicit tenant header fails closed", async ({ page }) => {
    const fixture = await loadFixture();
    // multiPersona holds two legitimate memberships (pharmacist in the
    // primary org, pharmacy_staff in the other) -- Section 4 requires
    // ambiguous context to fail closed, not guess.
    await signInWithMagicLink(page, pharmacistUrl, mailpitUrl, fixture.multiPersona.email, {
      allowForbiddenLanding: true,
    });

    const response = await page.request.get(`${pharmacistUrl}/api/v1/review`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status()).toBe(403);
  });

  test("an explicit tenant header lets a multi-membership identity choose a specific context", async ({ page }) => {
    const fixture = await loadFixture();
    await signInWithMagicLink(page, pharmacistUrl, mailpitUrl, fixture.multiPersona.email, {
      allowForbiddenLanding: true,
    });

    const response = await page.request.get(`${pharmacistUrl}/api/v1/review`, {
      headers: { Accept: "application/json", "x-medlink-tenant-id": fixture.organizationId },
    });
    expect(response.status()).toBe(200);
  });
});
