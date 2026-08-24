import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// Pharmacy onboarding/inventory harmonization pass: certifies that
// reserve_inventory now fails closed for a pharmacy location that has
// been deactivated since the medication access request was matched --
// mirroring the guard create_inventory_batch and search_inventory_availability
// already enforce. Reuses the existing medicine-identity-guard fixture
// (202608170063) rather than introducing a parallel one: it already seeds
// an organization, one active pharmacy location, a matching medicine and
// inventory batch, and a MAR ready to be matched.
live("reserve_inventory active pharmacy location guard", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;
  let patient: { id: string; client: SupabaseClient };
  let fixture: {
    organizationId: string;
    pharmacyLocationId: string;
    medicineId: string;
    inventoryBatchId: string;
    marId: string;
  };

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const email = `active-location-fixture-${nonce}@medlink.test`;
    const password = `ActiveLocationFixture-${nonce}-Strong!`;
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
      fixture_key: `active-loc-${nonce}`,
      patient_id: patient.id,
    });
    if (error) throw error;
    fixture = data as typeof fixture;

    const matched = await patient.client.rpc("match_inventory", {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: `${fixture.marId}:match`,
      target_channel: "test",
      target_mar_id: fixture.marId,
      target_inventory_batch_id: fixture.inventoryBatchId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
    });
    if (matched.error) throw matched.error;
  }, 60_000);

  function reserveArgs(idempotencyKey: string) {
    return {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: idempotencyKey,
      target_channel: "test",
      target_mar_id: fixture.marId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_inventory_batch_id: fixture.inventoryBatchId,
      target_quantity: 1,
      target_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  it("rejects reservation once the pharmacy location is deactivated, with no reservation/lock/MAR side effect, then succeeds once reactivated", async () => {
    const deactivated = await service
      .from("pharmacy_locations")
      .update({ is_active: false })
      .eq("id", fixture.pharmacyLocationId);
    expect(deactivated.error, JSON.stringify(deactivated.error)).toBeNull();

    const blockedKey = `${fixture.marId}:reserve-blocked`;
    const blocked = await patient.client.rpc("reserve_inventory", reserveArgs(blockedKey));
    expect(blocked.error).not.toBeNull();
    expect(blocked.error?.message).toContain("Pharmacy location is not active");

    const { data: noReservation, error: noReservationError } = await service
      .from("reservations")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("idempotency_key", blockedKey);
    expect(noReservationError, JSON.stringify(noReservationError)).toBeNull();
    expect(noReservation).toHaveLength(0);

    const { data: marAfterBlock, error: marAfterBlockError } = await service
      .from("medication_access_requests")
      .select("state")
      .eq("id", fixture.marId)
      .single();
    expect(marAfterBlockError, JSON.stringify(marAfterBlockError)).toBeNull();
    expect(marAfterBlock).toMatchObject({ state: "matched" });

    const reactivated = await service
      .from("pharmacy_locations")
      .update({ is_active: true })
      .eq("id", fixture.pharmacyLocationId);
    expect(reactivated.error, JSON.stringify(reactivated.error)).toBeNull();

    const succeededKey = `${fixture.marId}:reserve-succeeded`;
    const reserved = await patient.client.rpc("reserve_inventory", reserveArgs(succeededKey));
    expect(reserved.error, JSON.stringify(reserved.error)).toBeNull();
    expect((reserved.data as { status: string }).status).toBe("pending");
  });
});
