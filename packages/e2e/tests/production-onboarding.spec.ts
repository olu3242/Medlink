import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "../lib/auth";
import type { AuthE2EFixture } from "../lib/fixture";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const pharmacyUrl = process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002";
const pharmacistUrl = process.env.MEDLINK_E2E_PHARMACIST_URL ?? "http://localhost:3003";
const webUrl = process.env.MEDLINK_E2E_WEB_URL ?? "http://localhost:3004";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

async function fixture(): Promise<AuthE2EFixture> {
  return JSON.parse(await readFile(new URL("../.fixture.json", import.meta.url), "utf8"));
}

async function reviewerAction(page: Page, legalName: string, action: string) {
  await page.goto(`${webUrl}/partner/review`);
  const card = page.locator("article", { hasText: legalName });
  await card.getByRole("button", { name: action }).click();
  await expect(card.getByText("Saved")).toBeVisible();
}

test.setTimeout(180_000);
test.describe.configure({ mode: "serial" });

test("PUBLIC_BOOTSTRAPPED patient identity creates only a patient workspace", async ({ browser }) => {
  const nonce = Date.now().toString(36);
  const email = `public-patient-${nonce}@medlink.test`;
  const context = await browser.newContext();
  const page = await context.newPage();

  await signInWithMagicLink(page, patientUrl, mailpitUrl, email);
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();

  const service = createClient(
    process.env.MEDLINK_E2E_SUPABASE_URL!,
    process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  );
  const workspace = await service.from("organizations")
    .select("id,organization_memberships(user_id,role)")
    .contains("branding", { workspace: "patient" })
    .order("created_at", { ascending: false }).limit(1).single();
  expect(workspace.error).toBeNull();
  const memberships = workspace.data?.organization_memberships as Array<{ user_id: string; role: string }>;
  const userId = memberships[0]?.user_id;
  expect(userId).toBeTruthy();
  expect(memberships).toEqual([{ user_id: userId, role: "patient" }]);

  await page.goto(`${patientUrl}/auth/callback`);
  await expect(page).toHaveURL(/\/auth\/sign-in\?error=missing_code/);
  await context.close();

  const returnContext = await browser.newContext();
  const returnPage = await returnContext.newPage();
  await signInWithMagicLink(returnPage, patientUrl, mailpitUrl, email);
  await expect(returnPage.getByRole("heading", { name: "My requests" })).toBeVisible();
  const replay = await service.from("organization_memberships").select("id", { count: "exact", head: true }).eq("user_id", userId!).eq("role", "patient");
  expect(replay.error).toBeNull();
  expect(replay.count).toBe(1);
  await returnContext.close();
});

test("PUBLIC_BOOTSTRAPPED pharmacy plus INVITATION_BOOTSTRAPPED pharmacist complete governed onboarding", async ({ browser }) => {
  const authFixture = await fixture();
  const nonce = Date.now().toString(36);
  const applicantEmail = `public-pharmacy-${nonce}@medlink.test`;
  const pharmacistEmail = `invited-pharmacist-${nonce}@medlink.test`;
  const legalName = `Production Pharmacy ${nonce}`;

  const applicantContext = await browser.newContext();
  const applicant = await applicantContext.newPage();
  await signInWithMagicLink(applicant, webUrl, mailpitUrl, applicantEmail);
  await applicant.goto(`${webUrl}/partner`);
  await applicant.getByLabel("Legal organization name").fill(legalName);
  await applicant.getByLabel("Trading name").fill(`Production Rx ${nonce}`);
  await applicant.getByLabel("Partner type").selectOption("pharmacy");
  await applicant.getByLabel("Primary contact name").fill("Production Owner");
  await applicant.getByLabel("Role / title").fill("Owner");
  await applicant.getByLabel("Identity scheme").fill("CAC");
  await applicant.getByLabel("Registration / license number").fill(`RC-${nonce}`);
  await applicant.getByLabel("How will you work with MedLink?").fill("Operate a governed licensed pharmacy location with verified inventory and fulfillment controls.");
  await applicant.getByRole("button", { name: "Start application" }).click();
  await applicant.waitForURL(/\/partner\/portal\/[0-9a-f-]+$/);
  const applicationId = new URL(applicant.url()).pathname.split("/").pop()!;
  await applicant.getByRole("button", { name: "Submit pharmacy application" }).click();
  await expect(applicant.getByText("Saved")).toBeVisible();

  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await signInWithMagicLink(reviewer, webUrl, mailpitUrl, authFixture.partnerReviewer.email);
  await reviewerAction(reviewer, legalName, "Verify identity");
  await reviewerAction(reviewer, legalName, "Verify compliance");
  await reviewerAction(reviewer, legalName, "Approve relationship");
  await reviewerAction(reviewer, legalName, "Issue agreement");

  await applicant.reload();
  await applicant.getByRole("button", { name: "Accept current agreement" }).click();
  await expect(applicant.getByText("Saved")).toBeVisible();
  await applicant.getByLabel("Location name").fill(`Lagos Pharmacy ${nonce}`);
  await applicant.getByLabel("Pharmacy license number").fill(`PCN-${nonce}`);
  await applicant.getByLabel("Street address").fill("1 Production Way");
  await applicant.getByLabel("City / locality").fill("Lagos");
  await applicant.getByLabel("Latitude").fill("6.5244");
  await applicant.getByLabel("Longitude").fill("3.3792");
  await applicant.getByRole("button", { name: "Add licensed pharmacy location" }).click();
  await expect(applicant.getByText("Saved")).toBeVisible();
  const locationId = (await applicant.locator(".partner-actions p code").innerText()).trim();

  await reviewer.goto(`${webUrl}/partner/review`);
  let card = reviewer.locator("article", { hasText: legalName });
  await card.getByLabel("Pharmacy location ID").fill(locationId);
  await card.getByRole("button", { name: "Verify location capability" }).click();
  await expect(card.getByText("Saved")).toBeVisible();
  await reviewerAction(reviewer, legalName, "Certify integration");
  await reviewerAction(reviewer, legalName, "Activate partner");

  const unauthorizedAssignment = await applicant.evaluate(async ({ applicationId, email, nonce }) => {
    const response = await fetch(`/api/v1/partner/applications/${applicationId}/pharmacist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        licenseNumber: `PCN-SELF-${nonce}`,
        issuingAuthority: "PCN",
        licenseExpiresOn: "2099-12-31",
        reason: "Applicant must not be able to grant pharmacist authority.",
        idempotencyKey: `self-assignment-${nonce}`,
      }),
    });
    return response.status;
  }, { applicationId, email: applicantEmail, nonce });
  expect(unauthorizedAssignment).toBe(403);

  const identityContext = await browser.newContext();
  const identityPage = await identityContext.newPage();
  await signInWithMagicLink(identityPage, webUrl, mailpitUrl, pharmacistEmail);
  await identityContext.close();

  await reviewer.goto(`${webUrl}/partner/review`);
  card = reviewer.locator("article", { hasText: legalName });
  await card.getByLabel("Verified pharmacist email").fill(pharmacistEmail);
  await card.getByLabel("License number").fill(`PCN-P-${nonce}`);
  await card.getByLabel("License expiry").fill("2099-12-31");
  await card.getByRole("button", { name: "Assign verified pharmacist" }).click();
  await expect(card.getByText("Saved")).toBeVisible();

  const pharmacyContext = await browser.newContext();
  const pharmacy = await pharmacyContext.newPage();
  await signInWithMagicLink(pharmacy, pharmacyUrl, mailpitUrl, applicantEmail);
  await expect(pharmacy.getByRole("heading", { name: "Pharmacy inventory" })).toBeVisible();
  const pharmacistContext = await browser.newContext();
  const pharmacist = await pharmacistContext.newPage();
  await signInWithMagicLink(pharmacist, pharmacistUrl, mailpitUrl, pharmacistEmail);
  await expect(pharmacist.getByRole("heading", { name: "Pharmacist workspace" })).toBeVisible();

  await applicantContext.close();
  await reviewerContext.close();
  await pharmacyContext.close();
  await pharmacistContext.close();
});
