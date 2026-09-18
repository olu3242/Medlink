import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// P0 live certification for 202608240001_marketplace_registration_validity.sql:
// proves, against a real Postgres instance, that discover_marketplace_inventory
// excludes a medicine from EXACT_AVAILABLE/GENERIC_AVAILABLE/BOTH_AVAILABLE
// whenever public.medicine_has_valid_registration would return false, across
// every scenario the task named (valid, expired, missing, open-ended,
// multiple, and generic-related). NOT_EXECUTED_ENVIRONMENT_BLOCK when
// Docker/PostgreSQL is unavailable -- gated the same way every other live
// test in this repository is (MEDLINK_LIVE_SUPABASE_*).
live("marketplace registration validity (P0 live proof)", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;
  let patient: { id: string; client: SupabaseClient };
  let fixture: {
    organizationId: string;
    pharmacyLocationId: string;
    latitude: number;
    longitude: number;
    validMedicineId: string;
    expiredMedicineId: string;
    missingMedicineId: string;
    openEndedMedicineId: string;
    multipleMedicineId: string;
    genericRequestedMedicineId: string;
    genericExpiredMedicineId: string;
  };
  let consentId: string;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const email = `registration-validity-fixture-${nonce}@medlink.test`;
    const password = `RegistrationValidityFixture-${nonce}-Strong!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("fixture patient was not created");
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error("fixture patient could not sign in");
    }
    patient = { id: created.data.user.id, client };

    const { data, error } = await service.rpc("certify_marketplace_registration_validity_fixture", {
      fixture_key: `regvalid-${nonce}`,
      patient_id: patient.id,
    });
    if (error) throw error;
    fixture = data as typeof fixture;

    const consent = await patient.client.rpc("capture_marketplace_location_consent", {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_idempotency_key: `${fixture.organizationId}:regvalid-consent`,
    });
    if (consent.error) throw consent.error;
    consentId = (consent.data as { id: string }).id;
  }, 60_000);

  function discover(medicineId: string) {
    return patient.client.rpc("discover_marketplace_inventory", {
      target_patient_organization_id: fixture.organizationId,
      target_medicine_id: medicineId,
      target_latitude: fixture.latitude,
      target_longitude: fixture.longitude,
      target_radius_km: 1,
      target_quantity: 1,
      target_consent_id: consentId,
    });
  }

  it("A: currently valid registration -> eligible (EXACT_BRAND_AVAILABLE)", async () => {
    const { data, error } = await discover(fixture.validMedicineId);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ medicine_id: string; relationship: string }>)[0]).toMatchObject({
      medicine_id: fixture.validMedicineId, relationship: "exact",
    });
  });

  it("B: expired registration -> excluded (cannot produce EXACT_AVAILABLE)", async () => {
    const { data, error } = await discover(fixture.expiredMedicineId);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("C: no registration at all -> excluded (fails closed on missing evidence)", async () => {
    const { data, error } = await discover(fixture.missingMedicineId);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("D: open-ended valid_until -> eligible", async () => {
    const { data, error } = await discover(fixture.openEndedMedicineId);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ medicine_id: string }>)[0]?.medicine_id).toBe(fixture.openEndedMedicineId);
  });

  it("E: multiple registrations, one currently valid -> eligible", async () => {
    const { data, error } = await discover(fixture.multipleMedicineId);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ medicine_id: string }>)[0]?.medicine_id).toBe(fixture.multipleMedicineId);
  });

  it("F: generic-related candidate with expired registration -> excluded (cannot produce GENERIC_AVAILABLE/BOTH_AVAILABLE)", async () => {
    // generic_requested has no inventory of its own (see the fixture
    // migration) and a valid registration; its only possible discovery
    // result is the generic_expired candidate via the generic_related
    // branch. An expired registration on that candidate must exclude it,
    // leaving the result set empty -- proving NONE_AVAILABLE, not
    // GENERIC_AVAILABLE or BOTH_AVAILABLE.
    const { data, error } = await discover(fixture.genericRequestedMedicineId);
    expect(error, JSON.stringify(error)).toBeNull();
    expect(data).toHaveLength(0);
  });
});
