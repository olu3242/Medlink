import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// Authorization convergence repair, item 6: certifies decide_clinical_review's
// self-review guard (202609180088) directly against the RPC -- these calls go
// straight to Postgres via the anon-keyed, signed-in client, the same
// boundary the app layer's SupabaseClinicalReviewDecider calls through, so a
// pass here also serves as the "direct API bypass" case: the guard holds even
// when nothing routes through apps/web's Next.js handlers at all.
//
// Reuses certify_medication_golden_loop_fixture (202608170041) rather than
// introducing a parallel fixture: it already seeds an organization, a
// pharmacist membership, and a MAR with a pending clinical review tied to a
// chosen patient_id. Passing the SAME id as both patient_id and
// pharmacist_id gives that one user both the MAR's created_by and a
// pharmacist membership in the same organization -- exactly the self-review
// condition the guard exists to catch.
live("decide_clinical_review self-review guard", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;

  async function signedInUser(label: string) {
    const email = `clinical-review-${label}-${nonce}@medlink.test`;
    const password = `ClinicalReview-${label}-${nonce}-Strong!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`fixture ${label} was not created`);
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error(`fixture ${label} could not sign in`);
    }
    return { id: created.data.user.id, client };
  }

  async function goldenLoopFixture(fixtureKey: string, patientId: string, pharmacistId: string, pharmacyStaffId: string) {
    const { data, error } = await service.rpc("certify_medication_golden_loop_fixture", {
      fixture_key: fixtureKey,
      patient_id: patientId,
      pharmacist_id: pharmacistId,
      pharmacy_staff_id: pharmacyStaffId,
    });
    if (error) throw error;
    return data as { organizationId: string; marId: string; reviewId: string };
  }

  function decideArgs(organizationId: string, actorId: string, reviewId: string, idempotencyKey: string) {
    return {
      target_organization_id: organizationId,
      target_actor_id: actorId,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: idempotencyKey,
      target_channel: "test",
      target_review_id: reviewId,
      target_decision: "approved",
      target_recommendation: "Proceed as prescribed",
    };
  }

  beforeAll(() => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  }, 60_000);

  it("allows an independent pharmacist to decide a review they did not create", async () => {
    const patient = await signedInUser("indep-patient");
    const pharmacist = await signedInUser("indep-pharmacist");
    const staff = await signedInUser("indep-staff");
    const fixture = await goldenLoopFixture(`indep-${nonce}`, patient.id, pharmacist.id, staff.id);

    const decided = await pharmacist.client.rpc(
      "decide_clinical_review",
      decideArgs(fixture.organizationId, pharmacist.id, fixture.reviewId, `${fixture.reviewId}:indep-decide`),
    );
    expect(decided.error, JSON.stringify(decided.error)).toBeNull();
    expect((decided.data as { decision: string }).decision).toBe("approved");
  }, 60_000);

  it("denies self-review when the deciding pharmacist created the underlying request", async () => {
    const selfReviewer = await signedInUser("self-reviewer");
    const staff = await signedInUser("self-staff");
    // Same id as both patient_id (MAR creator) and pharmacist_id (deciding role).
    const fixture = await goldenLoopFixture(`self-${nonce}`, selfReviewer.id, selfReviewer.id, staff.id);

    const decided = await selfReviewer.client.rpc(
      "decide_clinical_review",
      decideArgs(fixture.organizationId, selfReviewer.id, fixture.reviewId, `${fixture.reviewId}:self-decide`),
    );
    expect(decided.error).not.toBeNull();
    expect(decided.error?.message).toContain("Self-review is prohibited");
  }, 60_000);

  it("denies a pharmacist from a different organization (cross-tenant)", async () => {
    const patient = await signedInUser("cross-patient");
    const ownPharmacist = await signedInUser("cross-own-pharmacist");
    const staff = await signedInUser("cross-staff");
    const fixture = await goldenLoopFixture(`cross-a-${nonce}`, patient.id, ownPharmacist.id, staff.id);

    const outsidePharmacist = await signedInUser("cross-outside-pharmacist");
    const outsidePatient = await signedInUser("cross-outside-patient");
    const outsideStaff = await signedInUser("cross-outside-staff");
    // Provisions outsidePharmacist as a real pharmacist -- just in a
    // different organization than the review under test.
    await goldenLoopFixture(`cross-b-${nonce}`, outsidePatient.id, outsidePharmacist.id, outsideStaff.id);

    const decided = await outsidePharmacist.client.rpc(
      "decide_clinical_review",
      decideArgs(fixture.organizationId, outsidePharmacist.id, fixture.reviewId, `${fixture.reviewId}:cross-decide`),
    );
    expect(decided.error).not.toBeNull();
    expect(decided.error?.message).toContain("Only a licensed pharmacist may decide a clinical review");
  }, 60_000);

  it("denies a patient (non-pharmacist role) attempting to decide", async () => {
    const patient = await signedInUser("unauth-patient");
    const pharmacist = await signedInUser("unauth-pharmacist");
    const staff = await signedInUser("unauth-staff");
    const fixture = await goldenLoopFixture(`unauth-${nonce}`, patient.id, pharmacist.id, staff.id);

    const decided = await patient.client.rpc(
      "decide_clinical_review",
      decideArgs(fixture.organizationId, patient.id, fixture.reviewId, `${fixture.reviewId}:unauth-decide`),
    );
    expect(decided.error).not.toBeNull();
    expect(decided.error?.message).toContain("Only a licensed pharmacist may decide a clinical review");
  }, 60_000);
});
