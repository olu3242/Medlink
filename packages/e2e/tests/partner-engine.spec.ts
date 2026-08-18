import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "../lib/auth";
import type { AuthE2EFixture } from "../lib/fixture";

const webUrl=process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const mailpitUrl=process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const supabaseUrl=process.env.MEDLINK_E2E_SUPABASE_URL!;
const serviceKey=process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY!;

test("authenticated applicant and reviewer activate the same canonical pharmacy with derived network readiness",async({browser})=>{
  const fixture=JSON.parse(await readFile(new URL("../.fixture.json",import.meta.url),"utf8")) as AuthE2EFixture;
  const nonce=Date.now().toString(36); const legalName=`Network Partner ${nonce}`;
  const applicantContext=await browser.newContext(); const applicant=await applicantContext.newPage();
  await signInWithMagicLink(applicant,webUrl,mailpitUrl,fixture.partnerApplicant.email);
  await applicant.goto(`${webUrl}/partner`);
  await applicant.getByLabel("Legal organization name").fill(legalName);
  await applicant.getByLabel("Trading name").fill(`Network Rx ${nonce}`);
  await applicant.getByLabel("Partner type").selectOption("pharmacy");
  await applicant.getByLabel("Primary contact name").fill("Network Owner");
  await applicant.getByLabel("Phone").fill("+2348000000000");
  await applicant.getByLabel("Role / title").fill("Owner");
  await applicant.getByLabel("Identity scheme").fill("CAC");
  await applicant.getByLabel("Registration / license number").fill(`RC-${nonce}`);
  await applicant.getByLabel("Website").fill("https://partner.example");
  await applicant.getByLabel("How will you work with MedLink?").fill("Operate a governed pharmacy location supplying safely mapped medicine inventory to eligible patients.");
  await applicant.getByRole("button",{name:"Start application"}).click();
  await applicant.waitForURL(/\/partner\/portal\/[0-9a-f-]+$/);
  const applicationId=applicant.url().split("/").at(-1)!;
  await applicant.getByRole("button",{name:"Submit for review"}).click();
  await expect(applicant.getByText("Saved")).toBeVisible();

  const reviewerContext=await browser.newContext(); const reviewer=await reviewerContext.newPage();
  await signInWithMagicLink(reviewer,webUrl,mailpitUrl,fixture.partnerReviewer.email);
  async function reviewAction(name:string){
    await reviewer.goto(`${webUrl}/partner/review`); const card=reviewer.locator("article",{hasText:legalName});
    await card.getByRole("button",{name}).click(); await expect(card.getByText("Saved")).toBeVisible();
  }
  await reviewAction("Verify identity");
  await reviewAction("Verify compliance");
  await reviewAction("Approve relationship");
  await reviewAction("Issue agreement");

  await applicant.reload();
  await applicant.getByRole("button",{name:"Accept current agreement"}).click();
  await expect(applicant.getByText("Saved")).toBeVisible();
  await reviewAction("Certify integration");

  const service=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
  const {data:application,error:applicationError}=await service.from("partner_applications").select("organization_id").eq("id",applicationId).single();
  expect(applicationError).toBeNull(); expect(application?.organization_id).toBeTruthy();
  const {data:location,error:locationError}=await service.from("pharmacy_locations").insert({organization_id:application!.organization_id,name:`Network Location ${nonce}`,license_number:`PCN-${nonce}`,address_line_1:"1 Network Way",locality:"Lagos",country_code:"NG",latitude:6.5244,longitude:3.3792}).select("id").single();
  expect(locationError).toBeNull();
  const now=new Date().toISOString();
  const evidence=await reviewer.request.post(`${webUrl}/api/v1/partner/applications/${applicationId}/location-capability`,{data:{locationId:location!.id,credentialStatus:"verified",inventoryIntegrationStatus:"healthy",inventoryFreshnessStatus:"current",medicationMappingStatus:"eligible",paymentCapabilityStatus:"ready",fulfillmentCapabilityStatus:"ready",freshnessPolicyReference:"approved://inventory-freshness/mvp",sourceUpdatedAt:now,lastSuccessfulSync:now,evidenceReference:`certification://browser/${nonce}`}});
  expect(evidence.status()).toBe(200);
  await reviewAction("Activate partner");
  await reviewer.goto(`${webUrl}/partner/review`);
  await expect(reviewer.locator("article",{hasText:legalName})).toContainText("active");
  const network=await reviewer.request.post(`${webUrl}/api/v1/partner/applications/${applicationId}/location-readiness`,{data:{locationId:location!.id}});
  expect(network.status()).toBe(200); expect((await network.json()).result).toMatchObject({networkReady:true,legacyNetwork:false,blockers:[]});
  await applicantContext.close(); await reviewerContext.close();
});
