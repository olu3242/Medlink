import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// Discovery outcome contract hardening, round 2: certifies that a patient
// cannot bypass pharmacist/discovery governance by calling reserve_inventory
// directly (skipping the app's UI, which never even offers a generic-related
// or unrelated inventory batch as reservable) with an inventory batch whose
// medicine does not match what their own medication access request asked
// for. match_inventory already enforces exact identity before a MAR can
// reach 'matched'; this proves reserve_inventory now independently
// re-enforces it rather than trusting the caller's batch selection.
live("reserve_inventory medicine identity guard", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;
  let patient: { id: string; client: SupabaseClient };
  let fixture: {
    organizationId: string;
    pharmacyLocationId: string;
    medicineId: string;
    otherMedicineId: string;
    inventoryBatchId: string;
    otherInventoryBatchId: string;
    marId: string;
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const email = `identity-guard-patient-${nonce}@medlink.test`;
    const password = `IdentityGuard-${nonce}-Strong!`;
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

    const { data, error } = await service.rpc("certify_medicine_identity_guard_fixture", {
      fixture_key: `identity-guard-${nonce}`,
      patient_id: patient.id,
    });
    if (error) throw error;
    fixture = data as typeof fixture;
  }, 60_000);

  function baseArgs() {
    return {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_channel: "test",
    };
  }

  it("rejects a reservation whose inventory batch does not match the MAR's requested medicine, then allows the correct one", async () => {
    const matched = await patient.client.rpc("match_inventory", {
      ...baseArgs(),
      target_idempotency_key: `${fixture.marId}:match`,
      target_mar_id: fixture.marId,
      target_inventory_batch_id: fixture.inventoryBatchId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
    });
    expect(matched.error, JSON.stringify(matched.error)).toBeNull();
    expect((matched.data as { state: string }).state).toBe("matched");

    const bypassAttempt = await patient.client.rpc("reserve_inventory", {
      ...baseArgs(),
      target_idempotency_key: `${fixture.marId}:bypass-attempt`,
      target_mar_id: fixture.marId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_inventory_batch_id: fixture.otherInventoryBatchId,
      target_quantity: 1,
      target_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(bypassAttempt.error).not.toBeNull();
    expect(bypassAttempt.error?.message).toContain("does not match the requested medicine");

    const { data: reservationsAfterBypass, error: reservationsAfterBypassError } = await service
      .from("reservations")
      .select("id")
      .eq("mar_id", fixture.marId);
    expect(reservationsAfterBypassError, JSON.stringify(reservationsAfterBypassError)).toBeNull();
    expect(reservationsAfterBypass).toHaveLength(0);

    const { data: marAfterBypass, error: marAfterBypassError } = await service
      .from("medication_access_requests")
      .select("state")
      .eq("id", fixture.marId)
      .single();
    expect(marAfterBypassError, JSON.stringify(marAfterBypassError)).toBeNull();
    expect(marAfterBypass?.state).toBe("matched");

    const legitimate = await patient.client.rpc("reserve_inventory", {
      ...baseArgs(),
      target_idempotency_key: `${fixture.marId}:legitimate`,
      target_mar_id: fixture.marId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_inventory_batch_id: fixture.inventoryBatchId,
      target_quantity: 1,
      target_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(legitimate.error, JSON.stringify(legitimate.error)).toBeNull();
    expect((legitimate.data as { status: string }).status).toBe("pending");

    const { data: lock, error: lockError } = await service
      .from("inventory_locks")
      .select("inventory_batch_id,status")
      .eq("reservation_id", (legitimate.data as { id: string }).id)
      .single();
    expect(lockError, JSON.stringify(lockError)).toBeNull();
    expect(lock).toMatchObject({ inventory_batch_id: fixture.inventoryBatchId, status: "active" });
  });
});
