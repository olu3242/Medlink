import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signInWithMagicLink } from "../lib/auth";
import type { GoldenLoopFixture } from "../lib/golden-fixture";

const patientUrl = process.env.MEDLINK_E2E_PATIENT_URL ?? "http://localhost:3000";
const pharmacyUrl = process.env.MEDLINK_E2E_PHARMACY_URL ?? "http://localhost:3002";
const pharmacistUrl = process.env.MEDLINK_E2E_PHARMACIST_URL ?? "http://localhost:3003";
const mailpitUrl = process.env.MEDLINK_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const webUrl = process.env.MEDLINK_E2E_WEB_URL ?? "http://localhost:3004";
const clinicalWorkerToken = process.env.MEDLINK_E2E_CLINICAL_WORKER_TOKEN
  ?? "medlink-e2e-clinical-worker-token-0001";
const whatsappAppSecret = process.env.MEDLINK_E2E_WHATSAPP_APP_SECRET
  ?? "medlink-e2e-whatsapp-secret-0001";

async function loadFixture(): Promise<GoldenLoopFixture> {
  const raw = await readFile(new URL("../.golden-loop-fixture.json", import.meta.url), "utf8");
  return JSON.parse(raw) as GoldenLoopFixture;
}

// Two real sign-ins plus a full multi-phase lifecycle exceeds the default
// 30s Playwright test timeout comfortably under normal conditions, but
// this suite already runs with retries:1 in CI for the same Mailpit-
// timing reasons the auth suite does (see docs/mvp-integration/
// AUTHENTICATION.md's "known, non-blocking test reliability debt").
test.setTimeout(180_000);
test.describe.configure({ retries: 0 });

test("authenticated medication access golden loop: patient -> pharmacist -> patient -> pharmacy -> patient -> pharmacy", async ({ browser }) => {
  const fixture = await loadFixture();
  const service = createClient(
    process.env.MEDLINK_E2E_SUPABASE_URL!,
    process.env.MEDLINK_E2E_SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  );
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
  const pharmacistContext = await browser.newContext();
  const pharmacistPage = await pharmacistContext.newPage();
  const pharmacyContext = await browser.newContext();
  const pharmacyPage = await pharmacyContext.newPage();
  let marId = fixture.marId;
  let reviewId = fixture.reviewId;
  let prescriptionId = "";
  let conversationId = "";
  let conversationWorkflowId = "";

  await test.step("patient uploads a prescription and governed providers produce human-review evidence", async () => {
    await signInWithMagicLink(patientPage, patientUrl, mailpitUrl, fixture.patient.email);
    await patientPage.goto(`${patientUrl}/prescriptions/new`);
    const uploadResponse = patientPage.waitForResponse((response) =>
      response.url().endsWith("/api/v1/prescriptions")
      && response.request().method() === "POST",
    );
    await patientPage.getByLabel("Choose a prescription").setInputFiles({
      name: "golden-loop-prescription.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% MedLink deterministic prescription\n"),
    });
    await patientPage.getByRole("button", { name: "Upload prescription" }).click();
    const accepted = await uploadResponse;
    expect(accepted.status(), await accepted.text()).toBe(201);
    const acceptedBody = await accepted.json() as {
      data: { prescriptionId: string; workflowId: string; status: string };
    };
    prescriptionId = acceptedBody.data.prescriptionId;
    expect(acceptedBody.data.status).toBe("received");
    await expect(patientPage.getByText(/queued for pharmacist review/i)).toBeVisible();

    for (const expectedStage of ["ocr", "parsing", "clinical_validation"]) {
      const worker = await patientPage.request.post(`${webUrl}/api/internal/clinical-pipeline`, {
        headers: { Authorization: `Bearer ${clinicalWorkerToken}` },
        data: { limit: 1 },
      });
      const body = await worker.text();
      expect(worker.status(), body).toBe(200);
      expect(JSON.parse(body).data.results[0]).toMatchObject({
        status: "completed",
        stage: expectedStage,
        prescriptionId,
      });
    }

    const { data: validation, error } = await service.from("clinical_validations")
      .select("id,status,workflow_run_id")
      .eq("prescription_id", prescriptionId)
      .single();
    expect(error, JSON.stringify(error)).toBeNull();
    expect(validation?.status).toBe("pending");
    reviewId = validation!.id;
    mark("prescriptionIntake");
  });

  await test.step("human pharmacist resolves the canonical medicine and approves the prescription", async () => {
    await signInWithMagicLink(pharmacistPage, pharmacistUrl, mailpitUrl, fixture.pharmacist.email);
    const reviewResponse = await pharmacistPage.request.get(
      `${pharmacistUrl}/api/v1/review/${reviewId}`,
      { headers: { Accept: "application/json" } },
    );
    const reviewBody = await reviewResponse.text();
    expect(reviewResponse.status(), reviewBody).toBe(200);
    await pharmacistPage.goto(`${pharmacistUrl}/review/${reviewId}`);
    await expect(pharmacistPage.getByRole("heading", {
      name: "Golden Loop Medicine",
      exact: true,
    })).toBeVisible();
    await pharmacistPage.getByLabel("Find canonical medicine").fill("Golden Loop Medicine");
    const medicineSearchResponse = pharmacistPage.waitForResponse((response) =>
      response.url().includes("/api/v1/medicines/search?")
      && response.request().method() === "GET",
    );
    await pharmacistPage.getByRole("button", { name: "Search" }).click();
    const searchResult = await medicineSearchResponse;
    const searchBody = await searchResult.text();
    expect(searchResult.status(), searchBody).toBe(200);
    expect(searchBody).toContain(fixture.medicineId);
    await pharmacistPage.getByRole("button", { name: new RegExp(fixture.medicineName) }).click();
    await pharmacistPage.getByRole("checkbox", { name: /Independent clinical context review required/ }).check();
    await pharmacistPage.getByLabel("Decision").selectOption("approved");
    await pharmacistPage.getByLabel("Clinical rationale or clarification request")
      .fill("Prescription evidence reviewed; canonical medicine confirmed by a human pharmacist.");
    const decisionResponse = pharmacistPage.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/review/${reviewId}`)
      && response.request().method() === "PATCH",
    );
    await pharmacistPage.getByRole("button", { name: "Record decision" }).click();
    const recordedDecision = await decisionResponse;
    const recordedDecisionBody = await recordedDecision.text();
    expect(recordedDecision.status(), recordedDecisionBody).toBe(200);
    await expect(pharmacistPage.getByText(/Decision recorded/)).toBeVisible();

    const { data: prescription, error } = await service.from("prescriptions")
      .select("status").eq("id", prescriptionId).single();
    expect(error, JSON.stringify(error)).toBeNull();
    expect(prescription?.status).toBe("validated");
    mark("prescriptionReview");
  });

  await test.step("patient creates the medication-access request from the approved prescription", async () => {
    await patientPage.goto(`${patientUrl}/prescriptions/${prescriptionId}`);
    await patientPage.getByRole("button", {
      name: new RegExp(`Start medication access for ${fixture.medicineName}`),
    }).click();
    await patientPage.waitForURL(/\/mar\/[0-9a-f-]+$/);
    marId = patientPage.url().split("/").at(-1)!;

    const validate = await pharmacistPage.request.post(
      `${pharmacistUrl}/api/v1/access-requests/${marId}/validate`,
    );
    expect(validate.status(), await validate.text()).toBe(200);
    const { data: accessReview, error } = await service.from("clinical_reviews")
      .select("id,decision").eq("mar_id", marId).single();
    expect(error, JSON.stringify(error)).toBeNull();
    expect(accessReview?.decision).toBe("pending");
    reviewId = accessReview!.id;
    mark("medicationAccessRequest");
  });

  await test.step("patient accesses the medication-access request", async () => {
    for (const path of [
      `/api/v1/mar/${marId}`,
      `/api/v1/mar/${marId}/timeline`,
    ]) {
      const response = await patientPage.request.get(`${patientUrl}${path}`, {
        headers: { Accept: "application/json" },
      });
      const body = await response.text();
      expect(response.status(), `${path}: ${body}`).toBe(200);
    }
    await patientPage.goto(`${patientUrl}/mar/${marId}`);
    // Canonical identity continuity, step 1: the MAR the patient sees is
    // the exact fixture medicine, not a substituted brand string or a
    // second identity for it.
    await expect(patientPage.getByRole("heading", { name: fixture.medicineName })).toBeVisible();
    await expect(patientPage.getByText("Current status: validated")).toBeVisible();
    mark("patientAccessMar");
  });

  await test.step("pharmacist reviews and approves the same medication-access request", async () => {
    await pharmacistPage.goto(`${pharmacistUrl}/access-review/${reviewId}`);
    await expect(pharmacistPage.getByRole("heading", { name: fixture.medicineName })).toBeVisible();
    await expect(pharmacistPage.getByText(fixture.medicineId)).toBeVisible();
    await expect(pharmacistPage.getByText(marId)).toBeVisible();
    await pharmacistPage.getByLabel("Decision").selectOption("approved");
    await pharmacistPage.getByLabel("Clinical recommendation").fill("Approved for canonical inventory matching.");
    await pharmacistPage.getByRole("button", { name: "Record access decision" }).click();
    await expect(pharmacistPage.getByText(/Review completed:/)).toBeVisible();

    const duplicate = await pharmacistPage.request.patch(
      `${pharmacistUrl}/api/v1/access-reviews/${reviewId}`,
      { data: { decision: "approved", recommendation: "Approved for canonical inventory matching." } },
    );
    expect(duplicate.ok()).toBe(true);
    mark("pharmacistReview");
  });

  await test.step("patient matches available inventory through real search", async () => {
    await patientPage.reload();
    await expect(patientPage.getByText("Current status: reviewed")).toBeVisible();
    await patientPage.getByRole("link", { name: "Find pharmacy stock" }).click();
    await patientPage.waitForURL(/\/search\?/);
    await expect(patientPage.getByText("Golden Loop Pharmacy")).toBeVisible();

    // Matching itself creates no reservation and no lock -- it is a read.
    const beforeMatch = await patientPage.request.get(`${patientUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    const beforeMatchBody = await beforeMatch.json() as { data: unknown[] };
    expect(beforeMatchBody.data).toHaveLength(0);

    await patientPage.getByRole("button", { name: "Review reservation" }).click();
    await patientPage.waitForURL(/\/reserve\//);
    expect(patientPage.url()).toContain(`marId=${marId}`);
    expect(patientPage.url()).toContain(`pharmacyLocationId=${fixture.pharmacyLocationId}`);
    expect(patientPage.url()).toContain(fixture.inventoryBatchId);

    const { data: matchedMar, error: matchedMarError } = await service
      .from("medication_access_requests")
      .select("state,requested_medicine_id")
      .eq("id", marId)
      .single();
    expect(matchedMarError, JSON.stringify(matchedMarError)).toBeNull();
    expect(matchedMar).toMatchObject({ state: "matched", requested_medicine_id: fixture.medicineId });
    const { data: preReserveLocks, error: preReserveLocksError } = await service
      .from("inventory_locks")
      .select("id")
      .eq("inventory_batch_id", fixture.inventoryBatchId);
    expect(preReserveLocksError, JSON.stringify(preReserveLocksError)).toBeNull();
    expect(preReserveLocks).toHaveLength(0);
    mark("patientMatch");
  });

  let reservationId = "";
  let inventoryLockId = "";
  await test.step("patient reserves; a duplicate submission does not create a second reservation", async () => {
    await patientPage.getByRole("button", { name: "Request reservation" }).click();
    await expect(patientPage.getByText(/Reservation requested/)).toBeVisible();

    // Duplicate browser submission reuses the deterministic idempotency key.
    // The canonical RPC returns the original success rather than exposing an
    // error, while the persisted count checks below prove no duplicate row,
    // lock, or lifecycle transition was created.
    const replayResponse = patientPage.waitForResponse((response) =>
      response.url().endsWith("/api/v1/reservations")
      && response.request().method() === "POST",
    );
    await patientPage.getByRole("button", { name: "Request reservation" }).click();
    expect((await replayResponse).ok()).toBe(true);
    await expect(patientPage.getByText(/Reservation requested/)).toBeVisible();

    const afterReserve = await patientPage.request.get(`${patientUrl}/api/v1/reservations`, {
      headers: { Accept: "application/json" },
    });
    const { data } = await afterReserve.json() as {
      data: ReadonlyArray<{ id: string; status: string }>;
    };
    expect(data).toHaveLength(1);
    expect(data[0]?.status).toBe("pending");
    reservationId = data[0]!.id;

    const { data: reservation, error: reservationError } = await service
      .from("reservations")
      .select("id,status,organization_id,patient_id,mar_id,pharmacy_location_id")
      .eq("id", reservationId)
      .single();
    expect(reservationError, JSON.stringify(reservationError)).toBeNull();
    expect(reservation).toMatchObject({
      status: "pending",
      organization_id: fixture.organizationId,
      patient_id: fixture.patient.userId,
      mar_id: marId,
      pharmacy_location_id: fixture.pharmacyLocationId,
    });
    const { data: lock, error: lockError } = await service
      .from("inventory_locks")
      .select("id,status,inventory_batch_id,reservation_id")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockError, JSON.stringify(lockError)).toBeNull();
    expect(lock).toMatchObject({
      status: "active",
      inventory_batch_id: fixture.inventoryBatchId,
      reservation_id: reservationId,
    });
    inventoryLockId = lock!.id;
    mark("patientReserve");
  });

  await test.step("pharmacy confirms; a duplicate confirm replays instead of double-transitioning", async () => {
    await signInWithMagicLink(pharmacyPage, pharmacyUrl, mailpitUrl, fixture.pharmacyStaff.email);
    const inboxResponse = await pharmacyPage.request.get(
      `${pharmacyUrl}/api/v1/reservations`,
      { headers: { Accept: "application/json" } },
    );
    expect(inboxResponse.status(), await inboxResponse.text()).toBe(200);
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
    const { data: lockAfterConfirm, error: lockAfterConfirmError } = await service
      .from("inventory_locks").select("status").eq("id", inventoryLockId).single();
    expect(lockAfterConfirmError, JSON.stringify(lockAfterConfirmError)).toBeNull();
    expect(lockAfterConfirm?.status).toBe("active");
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

    const { data: readyReservation, error: readyReservationError } = await service
      .from("reservations")
      .select("status,pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(readyReservationError, JSON.stringify(readyReservationError)).toBeNull();
    expect(readyReservation).toEqual({ status: "ready", pickup_code_hash: null });
    const { data: readyEvent, error: readyEventError } = await service
      .from("runtime_outbox_events")
      .select("event_type,payload")
      .eq("aggregate_id", reservationId)
      .eq("event_type", "reservation.ready.v1")
      .single();
    expect(readyEventError, JSON.stringify(readyEventError)).toBeNull();
    expect(JSON.stringify(readyEvent?.payload)).not.toMatch(/pickup|credential/i);
    const { data: lockAfterReady, error: lockAfterReadyError } = await service
      .from("inventory_locks").select("status").eq("id", inventoryLockId).single();
    expect(lockAfterReadyError, JSON.stringify(lockAfterReadyError)).toBeNull();
    expect(lockAfterReady?.status).toBe("active");
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

    const { data: credentialRow, error: credentialError } = await service
      .from("reservations")
      .select("pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(credentialError, JSON.stringify(credentialError)).toBeNull();
    expect(credentialRow?.pickup_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(credentialRow?.pickup_code_hash).not.toContain(pickupCode);
    const { data: credentialEvents, error: credentialEventsError } = await service
      .from("runtime_outbox_events")
      .select("payload")
      .eq("aggregate_id", reservationId);
    expect(credentialEventsError, JSON.stringify(credentialEventsError)).toBeNull();
    expect(JSON.stringify(credentialEvents)).not.toContain(pickupCode);

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
    const { data: afterWrongCode } = await service.from("reservations")
      .select("status").eq("id", reservationId).single();
    const { data: lockAfterWrongCode } = await service.from("inventory_locks")
      .select("status").eq("id", inventoryLockId).single();
    expect(afterWrongCode?.status).toBe("ready");
    expect(lockAfterWrongCode?.status).toBe("active");

    await pharmacyPage.getByLabel("Pickup code").fill(pickupCode);
    await pharmacyPage.getByRole("button", { name: "Collect" }).click();
    await expect(pharmacyPage.getByText("collected", { exact: true })).toBeVisible();

    const { data: collected, error: collectedError } = await service
      .from("reservations")
      .select("status,pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(collectedError, JSON.stringify(collectedError)).toBeNull();
    expect(collected).toEqual({ status: "collected", pickup_code_hash: null });
    const { data: consumedLock, error: consumedLockError } = await service
      .from("inventory_locks")
      .select("status")
      .eq("id", inventoryLockId)
      .single();
    expect(consumedLockError, JSON.stringify(consumedLockError)).toBeNull();
    expect(consumedLock?.status).toBe("consumed");
    mark("pharmacyCollect");
  });

  await test.step("cross-persona authorization fails safely", async () => {
    const patientConfirm = await patientPage.request.patch(
      `${pharmacyUrl}/api/v1/reservations/${reservationId}`,
      { data: { status: "confirmed" } },
    );
    expect(patientConfirm.status()).toBe(403);
    const patientReady = await patientPage.request.post(
      `${pharmacyUrl}/api/v1/reservations/${reservationId}/ready`,
    );
    expect(patientReady.status()).toBe(403);
    const patientCollect = await patientPage.request.post(
      `${pharmacyUrl}/api/v1/reservations/${reservationId}/collect`,
      { data: { pickupCode: "WRONGCODE" } },
    );
    expect(patientCollect.status()).toBe(403);

    const patientClinicalApproval = await patientPage.request.patch(
      `${pharmacistUrl}/api/v1/access-reviews/${reviewId}`,
      { data: { decision: "approved", recommendation: "Unauthorized" } },
    );
    expect(patientClinicalApproval.status()).toBe(403);

    const pharmacyClinicalApproval = await pharmacyPage.request.patch(
      `${pharmacistUrl}/api/v1/access-reviews/${reviewId}`,
      { data: { decision: "approved", recommendation: "Unauthorized" } },
    );
    expect(pharmacyClinicalApproval.status()).toBe(403);

    const pharmacistCredential = await pharmacistPage.request.post(
      `${patientUrl}/api/v1/reservations/${reservationId}/credential`,
      { data: { pickupCodeHash: "0".repeat(64) } },
    );
    expect(pharmacistCredential.status()).toBe(403);

    const pharmacyCredential = await pharmacyPage.request.post(
      `${patientUrl}/api/v1/reservations/${reservationId}/credential`,
      { data: { pickupCodeHash: "0".repeat(64) } },
    );
    expect(pharmacyCredential.status()).toBe(403);

    for (const [page, url] of [
      [patientPage, `${patientUrl}/api/v1/mar`],
      [pharmacistPage, `${pharmacistUrl}/api/v1/access-reviews/${reviewId}`],
      [pharmacyPage, `${pharmacyUrl}/api/v1/reservations`],
    ] as const) {
      const crossTenant = await page.request.get(url, {
        headers: { "x-medlink-tenant-id": fixture.isolationOrganizationId },
      });
      expect(crossTenant.status()).toBe(403);
    }
  });

  await test.step("persisted identity, audit, idempotency, and outbox evidence are continuous", async () => {
    const { data: batch, error: batchError } = await service.from("inventory_batches")
      .select("medicine_id,pharmacy_location_id,quantity_reserved")
      .eq("id", fixture.inventoryBatchId).single();
    expect(batchError, JSON.stringify(batchError)).toBeNull();
    expect(batch).toMatchObject({
      medicine_id: fixture.medicineId,
      pharmacy_location_id: fixture.pharmacyLocationId,
      quantity_reserved: 0,
    });

    const { data: review, error: reviewError } = await service.from("clinical_reviews")
      .select("mar_id,decision,reviewed_by")
      .eq("id", reviewId).single();
    expect(reviewError, JSON.stringify(reviewError)).toBeNull();
    expect(review).toMatchObject({
      mar_id: marId,
      decision: "approved",
      reviewed_by: fixture.pharmacist.userId,
    });

    const { data: transitions, error: transitionsError } = await service
      .from("fulfillment_transitions")
      .select("to_state,step")
      .eq("reservation_id", reservationId);
    expect(transitionsError, JSON.stringify(transitionsError)).toBeNull();
    expect(transitions?.filter(({ to_state }) => to_state === "confirmed")).toHaveLength(1);
    expect(transitions?.filter(({ to_state }) => to_state === "collected")).toHaveLength(1);

    const { data: outbox, error: outboxError } = await service.from("runtime_outbox_events")
      .select("event_type,payload,correlation_id,workflow_id,conversation_id")
      .eq("aggregate_id", reservationId);
    expect(outboxError, JSON.stringify(outboxError)).toBeNull();
    const eventTypes = new Set((outbox ?? []).map(({ event_type }) => event_type));
    for (const expectedEvent of [
      "reservation.confirmed.v1", "reservation.ready.v1",
      "reservation.credential_issued.v1", "reservation.collected.v1",
    ]) expect(eventTypes.has(expectedEvent)).toBe(true);

    const { data: marAudit, error: marAuditError } = await service.from("mar_audit_events")
      .select("from_state,to_state,actor_id,correlation_id")
      .eq("mar_id", marId)
      .order("id");
    expect(marAuditError, JSON.stringify(marAuditError)).toBeNull();
    expect((marAudit ?? []).map(({ to_state }) => to_state)).toEqual([
      "created", "validated", "reviewed", "searching", "matched", "reserved",
    ]);

    const { data: agentRuns, error: agentRunsError } = await service.from("ai_runs")
      .select("id,agent_name,status,prescription_id,mar_id,input_reference,idempotency_key")
      .eq("organization_id", fixture.organizationId)
      .or(`prescription_id.eq.${prescriptionId},mar_id.eq.${marId}`);
    expect(agentRunsError, JSON.stringify(agentRunsError)).toBeNull();
    const governedRuns = (agentRuns ?? []).filter(({ idempotency_key }) =>
      idempotency_key.startsWith("agent-task:"));
    const requiredAgents = new Set([
      "ocr_agent",
      "clinical_review_assistant",
      "medicine_match_agent",
      "inventory_agent",
      "reservation_coordinator",
    ]);
    const observedAgents = new Set(governedRuns.map(({ agent_name }) => agent_name));
    for (const agent of requiredAgents) expect(observedAgents.has(agent)).toBe(true);
    for (const run of governedRuns) {
      expect(run.status).toBe("completed");
      expect(run.prescription_id).toBe(prescriptionId);
      if (["inventory_agent", "reservation_coordinator"].includes(run.agent_name)) {
        expect(run.mar_id).toBe(marId);
      }
      expect(run.input_reference).toMatchObject({
        agentId: expect.any(String),
        capability: expect.any(String),
        persona: expect.any(String),
        requiresHumanApproval: expect.any(Boolean),
      });
    }
    const runIds = governedRuns.map(({ id }) => id);
    const { data: agentAudit, error: agentAuditError } = await service
      .from("ai_audit_events")
      .select("ai_run_id,event_type,actor_id,metadata")
      .in("ai_run_id", runIds);
    expect(agentAuditError, JSON.stringify(agentAuditError)).toBeNull();
    for (const runId of runIds) {
      const events = (agentAudit ?? []).filter(({ ai_run_id }) => ai_run_id === runId);
      expect(events.some(({ event_type }) => event_type === "AgentTask.started")).toBe(true);
      expect(events.some(({ event_type }) => event_type === "AgentTask.completed")).toBe(true);
    }

    const externalMessageId = `wamid.${reservationId}`;
    const webhookPayload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "golden-loop-entry",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: fixture.whatsappPhoneNumberId },
            messages: [{
              from: fixture.whatsappChannelIdentity,
              id: externalMessageId,
              timestamp: String(Math.floor(Date.now() / 1_000)),
              type: "text",
              text: { body: `find ${fixture.medicineName}` },
            }],
          },
        }],
      }],
    };
    const rawWebhook = JSON.stringify(webhookPayload);
    const signature = `sha256=${createHmac("sha256", whatsappAppSecret)
      .update(rawWebhook, "utf8").digest("hex")}`;
    const invalidSignature = await patientPage.request.post(
      `${webUrl}/api/whatsapp/webhook`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        data: rawWebhook,
      },
    );
    expect(invalidSignature.status()).toBe(401);

    for (let delivery = 0; delivery < 2; delivery += 1) {
      const response = await patientPage.request.post(
        `${webUrl}/api/whatsapp/webhook`,
        {
          headers: {
            "Content-Type": "application/json",
            "x-hub-signature-256": signature,
          },
          data: rawWebhook,
        },
      );
      expect(response.status(), await response.text()).toBe(200);
    }

    const { data: conversations, error: conversationError } = await service
      .from("conversations")
      .select("id,patient_id,current_intent,active_workflow_instance_id")
      .eq("organization_id", fixture.organizationId)
      .eq("channel_identity", fixture.whatsappChannelIdentity);
    expect(conversationError, JSON.stringify(conversationError)).toBeNull();
    expect(conversations).toHaveLength(1);
    expect(conversations?.[0]).toMatchObject({
      patient_id: fixture.patient.userId,
      current_intent: "medicine_search",
      active_workflow_instance_id: expect.any(String),
    });
    conversationId = conversations![0]!.id;
    conversationWorkflowId = conversations![0]!.active_workflow_instance_id!;

    const { data: inbound, error: inboundError } = await service
      .from("conversation_messages")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("external_message_id", externalMessageId);
    expect(inboundError, JSON.stringify(inboundError)).toBeNull();
    expect(inbound).toHaveLength(1);

    const { data: workflow, error: workflowError } = await service
      .from("workflow_instances")
      .select("id,status,completed_steps,context")
      .eq("id", conversationWorkflowId)
      .single();
    expect(workflowError, JSON.stringify(workflowError)).toBeNull();
    expect(workflow).toMatchObject({
      status: "completed",
      completed_steps: ["search_catalog"],
      context: {
        conversationId,
        patientId: fixture.patient.userId,
        searchResults: { matches: expect.any(Array) },
      },
    });
    expect(JSON.stringify(workflow?.context)).toContain(fixture.medicineId);

    const { data: conversationAgent, error: conversationAgentError } = await service
      .from("ai_runs")
      .select("id,status,correlation_id,input_reference")
      .eq("organization_id", fixture.organizationId)
      .eq("agent_name", "conversation_agent")
      .eq("correlation_id", externalMessageId)
      .single();
    expect(conversationAgentError, JSON.stringify(conversationAgentError)).toBeNull();
    expect(conversationAgent).toMatchObject({
      status: "completed",
      input_reference: {
        agentId: "conversation",
        capability: "route_intent",
        persona: "patient",
        conversationId,
        workflowId: conversationWorkflowId,
      },
    });

    console.log("golden-loop identifiers:", JSON.stringify({
      organizationId: fixture.organizationId,
      isolationOrganizationId: fixture.isolationOrganizationId,
      medicineId: fixture.medicineId,
      prescriptionId,
      marId,
      reviewId,
      inventoryBatchId: fixture.inventoryBatchId,
      reservationId,
      inventoryLockId,
      conversationId,
      conversationWorkflowId,
    }));
  });

  console.log(
    "golden-loop phase durations (ms):",
    JSON.stringify({ ...phaseDurationsMs, totalMs: Date.now() - startedAt }),
  );
});
