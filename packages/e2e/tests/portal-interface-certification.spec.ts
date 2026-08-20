import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "../lib/auth";
import type { AuthE2EFixture } from "../lib/fixture";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const pharmacyUrl = process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002";
const pharmacistUrl = process.env.MEDLINK_E2E_PHARMACIST_URL ?? "http://localhost:3003";
const webUrl = process.env.MEDLINK_E2E_WEB_URL ?? "http://localhost:3004";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const artifactDirectory = process.env.MEDLINK_PORTAL_SCREENSHOT_DIR
  ?? path.resolve("portal-certification-artifacts");

async function loadFixture(): Promise<AuthE2EFixture> {
  const raw = await readFile(new URL("../.fixture.json", import.meta.url), "utf8");
  return JSON.parse(raw) as AuthE2EFixture;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }))
      .filter(({ left, right }) => left < 0 || right > document.documentElement.clientWidth)
      .slice(0, 12),
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions.offenders, null, 2))
    .toBeLessThanOrEqual(dimensions.clientWidth);
}

async function openAndCheck(page: Page, url: string, heading: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expectNoHorizontalOverflow(page);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`portal interfaces remain usable at ${viewport.name}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const fixture = await loadFixture();
    await mkdir(artifactDirectory, { recursive: true });

    const webContext = await browser.newContext({ viewport });
    const webPage = await webContext.newPage();
    await openAndCheck(webPage, webUrl, "Verified medicine, from a pharmacy near you.");
    await webPage.screenshot({
      path: path.join(artifactDirectory, `${viewport.name}-web.png`),
      fullPage: true,
    });
    await openAndCheck(webPage, `${webUrl}/auth/sign-in`, "Sign in");
    await webContext.close();

    const patientContext = await browser.newContext({ viewport });
    const patientPage = await patientContext.newPage();
    await signInWithMagicLink(patientPage, patientUrl, mailpitUrl, fixture.patient.email);
    await openAndCheck(patientPage, patientUrl, "My requests");
    await expect(patientPage.locator(".error[role=alert]")).toHaveCount(0);
    await patientPage.screenshot({
      path: path.join(artifactDirectory, `${viewport.name}-patient.png`),
      fullPage: true,
    });
    await openAndCheck(patientPage, `${patientUrl}/search`, "Find medicine nearby");
    await openAndCheck(patientPage, `${patientUrl}/medicines`, "Medicine catalogue");
    await openAndCheck(patientPage, `${patientUrl}/reservations`, "Your reservations");
    await patientContext.close();

    const pharmacyContext = await browser.newContext({ viewport });
    const pharmacyPage = await pharmacyContext.newPage();
    await signInWithMagicLink(pharmacyPage, pharmacyUrl, mailpitUrl, fixture.pharmacyStaff.email);
    await openAndCheck(pharmacyPage, pharmacyUrl, "Pharmacy inventory");
    await expect(pharmacyPage.getByText("Loading tenant inventory…")).not.toBeVisible();
    await expect(pharmacyPage.locator(".error[role=alert]")).toHaveCount(0);
    await pharmacyPage.screenshot({
      path: path.join(artifactDirectory, `${viewport.name}-pharmacy.png`),
      fullPage: true,
    });
    await openAndCheck(pharmacyPage, `${pharmacyUrl}/reservations`, "Reservations");
    await pharmacyContext.close();

    const pharmacistContext = await browser.newContext({ viewport });
    const pharmacistPage = await pharmacistContext.newPage();
    await signInWithMagicLink(
      pharmacistPage,
      pharmacistUrl,
      mailpitUrl,
      fixture.pharmacist.email,
    );
    await openAndCheck(pharmacistPage, pharmacistUrl, "Pharmacist workspace");
    await expect(pharmacistPage.locator(".error[role=alert]")).toHaveCount(0);
    await pharmacistPage.screenshot({
      path: path.join(artifactDirectory, `${viewport.name}-pharmacist.png`),
      fullPage: true,
    });
    await pharmacistContext.close();
  });
}
