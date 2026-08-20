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

async function expectAccessibleTextContrast(page: Page): Promise<void> {
  const failures = await page.evaluate(() => {
    const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: string) => {
      const [red = 0, green = 0, blue = 0] = channels(color).map((value) => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * red + .7152 * green + .0722 * blue;
    };
    const background = (element: Element) => {
      let current: Element | null = element;
      while (current) {
        const color = getComputedStyle(current).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    return Array.from(document.querySelectorAll(".ml-main label, .ml-main h2, .ml-main h3"))
      .flatMap((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || !element.textContent?.trim()) return [];
        const foregroundLuminance = luminance(style.color);
        const backgroundLuminance = luminance(background(element));
        const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + .05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + .05);
        const large = Number.parseFloat(style.fontSize) >= 24
          || (Number.parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        const required = large ? 3 : 4.5;
        return ratio + .01 < required
          ? [{ tag: element.tagName, text: element.textContent.trim().slice(0, 80), ratio, required }]
          : [];
      });
  });
  expect(failures).toEqual([]);
}

async function openAndCheck(page: Page, url: string, heading: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessibleTextContrast(page);
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
    await openAndCheck(patientPage, `${patientUrl}/prescriptions/new`, "Add a prescription");
    await expect(patientPage.getByRole("button", { name: "Submit prescription for review" })).toBeDisabled();
    if (viewport.name === "desktop") {
      await patientPage.getByLabel("Choose a prescription").setInputFiles({
        name: "staged-prescription.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n% MedLink staged UX fixture\n%%EOF"),
      });
      await expect(patientPage.locator(".prescription-dropzone span")).toContainText("staged-prescription.pdf");
      await expect(patientPage.getByRole("button", { name: "Submit prescription for review" })).toBeEnabled();
      await patientPage.getByLabel("Prescriber").fill("Dr Draft Recovery");
      await expect.poll(() => patientPage.evaluate(() =>
        localStorage.getItem("medlink:patient:manual-prescription-draft:v1")))
        .toContain("Dr Draft Recovery");
      await patientPage.getByLabel("Medicine name").fill("Golden Loop");
      const option = patientPage.getByRole("option").first();
      await expect(option).toBeVisible();
      await option.getByRole("button", { name: "Add" }).click();
      await expect(patientPage.getByRole("button", { name: "Submit for review" })).toHaveClass(/button/);
      await expect(patientPage.getByRole("button", { name: "Save draft" })).toHaveClass(/secondary-button/);
      await patientPage.evaluate(() => localStorage.removeItem("medlink:patient:manual-prescription-draft:v1"));
    }
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
