import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "../lib/auth";
import type { GoldenLoopFixture } from "../lib/golden-fixture";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const pharmacyUrl = process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

async function loadFixture(): Promise<GoldenLoopFixture> {
  const raw = await readFile(new URL("../.golden-loop-fixture.json", import.meta.url), "utf8");
  return JSON.parse(raw) as GoldenLoopFixture;
}

// Two real sign-ins plus a full multi-phase lifecycle exceeds the default
// 30s Playwright test timeout comfortably under normal conditions, but
// this suite already runs with retries:1 in CI for the same Mailpit-
// timing reasons the auth suite does (see docs/mvp-integration/
// AUTHENTICATION.md's "known, non-blocking test reliability debt").
test.setTimeout(120_000);

// PHARMACIST REVIEW GAP (see docs/release/MEDLINK_RC1_RELEASE_READINESS.md
// and this PR's report): the MAR pipeline's decide_clinical_review RPC has
// no browser UI at all -- only an internal worker and the WhatsApp
// workflow orchestrator call it. The only real pharmacist "approve" UI
// drives a separate pipeline (prescriptions/clinical_validations) that
// never reaches a reservation. Building that UI is out of scope for this
// PR (a deliberate, discussed scope decision, not an oversight). The MAR
// this suite exercises is therefore fixture-certified through 'matched'
// (walking the real state machine and its guarding trigger, with a real
// approved clinical_reviews row attributed to the pharmacist persona --
// see the fixture migration) rather than driven by a pharmacist browser
// click. Every step from here on -- match, reserve, confirm, ready,
// credential, collect -- runs through the real authenticated application,
// real Postgres, real RLS, real RPCs, with no synthetic session or
// service-role bypass in the browser.
test("authenticated medication access golden loop: patient match/reserve -> pharmacy confirm/ready -> patient credential -> pharmacy collect", async ({ browser }) => {
  const fixture = await loadFixture();
  const startedAt = Date.now();
  const phaseDurationsMs: Record<string, number> = {};
  let lastMark = startedAt;
  function mark(phase: string): void {
    const now = Date.now();
    phaseDurationsMs[phase] = now - lastMark;
    lastMark = now;
  }

  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  const pharmacyContext = await browser.newContext();
  const pharmacyPage = await pharmacyContext.newPage();

  await test.step("patient accesses the medication-access request", async () => {
    await signInWithMagicLink(patientPage, patientUrl, mailpitUrl, fixture.patient.email);
    await patientPage.goto(`${patientUrl}/mar/${fixture.marId}`);
    // Canonical identity continuity, step 1: the MAR the patient sees is
    // the exact fixture medicine, not a substituted brand string or a
    // second identity for it.
    await expect(patientPage.getByRole("heading", { name: fixture.medicineName })).toBeVisible();
    await expect(patientPage.getByText("Current status: matched")).toBeVisible();
    mark("patientAccessMar");
  });

  await test.step("patient matches available inventory through real search", async () => {
    await patientPage.getByRole("link", { name: "Find pharmacy stock" }).click();
    await patientPage.waitForURL(/\/search\?/);
    await expect(patientPage.getByText("Golden Loop Pharmacy")).toBeVisible();

    const reserveLink = patientPage.getByRole("link", { name: "Review reservation" });
    const href = await reserveLink.getAttribute("href");
    // Canonical identity continuity, step 2: the same MAR and the same
    // pharmacy location the fixture created, carried forward by the real
    // search->reserve link, not re-derived or substituted.
    expect(href).toContain(`marId=${fixture.marId}`);
    expect(href).toContain(`pharmacyLocationId=${fixture.pharmacyLocationId}`);
    expect(href).toContain(fixture.inventoryBatchId);

    // Matching itself creates no reservation and no lock -- it is a read.
    const beforeMatch = await patientPage.request.get(`${patientUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    const beforeMatchBody = await beforeMatch.json() as { data: unknown[] };
    expect(beforeMatchBody.data).toHaveLength(0);

    await reserveLink.click();
    await patientPage.waitForURL(/\/reserve\//);
    mark("patientMatch");
  });

  let reservationId = "";
  await test.step("patient reserves; a duplicate submission does not create a second reservation", async () => {
    await patientPage.getByRole("button", { name: "Request reservation" }).click();
    await expect(patientPage.getByText(/Reservation requested/)).toBeVisible();

    // Duplicate browser submission: the MAR is no longer 'matched' after
    // the first reservation succeeds (reserve_inventory advances it to
    // 'reserved'), so a genuine second click must fail cleanly rather than
    // silently creating a second reservation -- proving the real state
    // machine, not a client-side de-dup guard, is what makes this safe.
    await patientPage.getByRole("button", { name: "Request reservation" }).click();
    await expect(patientPage.getByText(/could not be requested/)).toBeVisible();

    const afterReserve = await patientPage.request.get(`${patientUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    const { data } = await afterReserve.json() as {
      data: ReadonlyArray<{ id: string; status: string }>;
    };
    expect(data).toHaveLength(1);
    expect(data[0]?.status).toBe("pending");
    reservationId = data[0]!.id;
    mark("patientReserve");
  });

  await test.step("pharmacy confirms; a duplicate confirm replays instead of double-transitioning", async () => {
    await signInWithMagicLink(pharmacyPage, pharmacyUrl, mailpitUrl, fixture.pharmacyStaff.email);
    await pharmacyPage.goto(`${pharmacyUrl}/reservations`);
    // Canonical identity continuity, step 3: the pharmacy sees the same
    // patient and the same medicine the fixture and the reservation above
    // both used.
    await expect(pharmacyPage.getByText(fixture.patient.userId)).toBeVisible();
    await expect(pharmacyPage.getByText(fixture.medicineName)).toBeVisible();

    await pharmacyPage.getByRole("button", { name: "Confirm stock" }).click();
    await expect(pharmacyPage.getByText("confirmed", { exact: true })).toBeVisible();

    // decideReservation derives its idempotency key deterministically from
    // reservationId+status (apps/pharmacy/lib/reservations.ts), so any
    // repeat confirm call -- not just a literal double-click, which the
    // UI's own optimistic re-render already prevents by removing the
    // button -- must replay the same transition, never create a second
    // fulfillment_transitions row.
    const duplicateConfirm = await pharmacyPage.request.patch(
      `${pharmacyUrl}/api/v1/reservations/${reservationId}`,
      { headers: { "Content-Type": "application/json" }, data: { status: "confirmed" } },
    );
    expect(duplicateConfirm.ok()).toBe(true);
    const duplicateConfirmBody = await duplicateConfirm.json() as { data: { status: string } };
    expect(duplicateConfirmBody.data.status).toBe("confirmed");
    mark("pharmacyConfirm");
  });

  await test.step("pharmacy marks ready; no pickup credential is ever exposed to pharmacy staff", async () => {
    await pharmacyPage.getByRole("button", { name: "Mark ready for pickup" }).click();
    await expect(pharmacyPage.getByText("ready", { exact: true })).toBeVisible();

    // mark_reservation_ready no longer issues or returns a credential --
    // the pharmacy UI's own "Pickup code for the patient" reveal branch is
    // dead code post-refactor; assert it genuinely never renders.
    const cardText = await pharmacyPage.locator("article", { hasText: fixture.medicineName }).innerText();
    expect(cardText).not.toMatch(/pickup code for the patient/i);

    const duplicateReady = await pharmacyPage.request.post(
      `${pharmacyUrl}/api/v1/reservations/${reservationId}/ready`,
    );
    expect(duplicateReady.ok()).toBe(true);
    mark("pharmacyReady");
  });

  let pickupCode = "";
  await test.step("patient issues a pickup credential; the plaintext never leaves this step", async () => {
    await patientPage.goto(`${patientUrl}/reservations`);
    await patientPage.getByRole("button", { name: "Generate pickup code" }).click();
    const alert = patientPage.getByRole("status").filter({ hasText: "Your pickup code" });
    await expect(alert).toBeVisible();
    pickupCode = (await alert.locator("p").first().innerText()).trim();
    expect(pickupCode).toMatch(/^[0-9A-Z]{8}$/);

    // Regenerating (a second click) must be impossible once issued -- the
    // component swaps to "already generated" text, no fresh code, no
    // rotation. This is the UI proof; issue_pickup_credential's own
    // same-key-same-hash replay guard is the RPC-level proof.
    await patientPage.reload();
    await expect(patientPage.getByText("Pickup code already generated")).toBeVisible();
    await expect(patientPage.getByRole("button", { name: "Generate pickup code" })).toHaveCount(0);
    mark("patientCredential");
  });

  await test.step("pharmacy rejects a wrong code, then collects with the real code", async () => {
    await pharmacyPage.reload();
    await pharmacyPage.getByLabel("Pickup code").fill("WRONGCODE");
    await pharmacyPage.getByRole("button", { name: "Collect" }).click();
    await expect(pharmacyPage.getByText(/could not be loaded or updated/)).toBeVisible();
    // Rejection is safe: the reservation is still ready, not corrupted.
    await expect(pharmacyPage.getByText("ready", { exact: true })).toBeVisible();

    await pharmacyPage.getByLabel("Pickup code").fill(pickupCode);
    await pharmacyPage.getByRole("button", { name: "Collect" }).click();
    await expect(pharmacyPage.getByText("collected", { exact: true })).toBeVisible();
    mark("pharmacyCollect");
  });

  await test.step("cross-app isolation: neither persona's session reaches the other app's fulfillment routes", async () => {
    // No cross-app cookie sharing exists by design (see
    // docs/mvp-integration/AUTHENTICATION.md's session model) -- a
    // patient session carries no credentials at all on the pharmacy
    // app's origin, and vice versa, so these fail closed at
    // authentication, before any role check is even reached.
    const patientOnPharmacy = await patientPage.request.get(`${pharmacyUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    expect(patientOnPharmacy.status()).toBe(401);

    const pharmacyOnPatient = await pharmacyPage.request.get(`${patientUrl}/api/v1/mar`, {
      headers: { Accept: "application/json" },
    });
    expect(pharmacyOnPatient.status()).toBe(401);
  });

  // eslint-disable-next-line no-console
  console.log(
    "golden-loop phase durations (ms):",
    JSON.stringify({ ...phaseDurationsMs, totalMs: Date.now() - startedAt }),
  );
});
