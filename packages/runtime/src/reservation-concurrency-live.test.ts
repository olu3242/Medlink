import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// Reservation concurrency / no-oversell certification. Does not modify
// reserve_inventory, sync_inventory_lock_quantity, or
// release_expired_inventory_holds -- all three already exist, unchanged.
// This suite proves the existing atomic-conditional-UPDATE mechanism
// (packages/runtime/src/reservation-concurrency-atomicity.test.ts
// certifies its shape statically) actually holds under real concurrent
// writes against a live database: no oversell, no duplicate reservation,
// idempotent replay -- sequential and concurrent -- collapses to exactly
// one reservation, expiry restores capacity exactly once, and a
// cross-tenant attempt fails closed.
live("reservation concurrency and no-oversell", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;
  let patients: Array<{ id: string; client: SupabaseClient }>;
  let fixture: {
    organizationId: string;
    otherOrganizationId: string;
    pharmacyLocationId: string;
    otherPharmacyLocationId: string;
    medicineId: string;
    marIds: string[];
  };

  async function actor(label: string): Promise<{ id: string; client: SupabaseClient }> {
    const email = `concurrency-fixture-${label}-${nonce}@medlink.test`;
    const password = `ConcurrencyFixture-${nonce}-Strong!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`fixture patient "${label}" was not created`);
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error(`fixture patient "${label}" could not sign in`);
    }
    return { id: created.data.user.id, client };
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    patients = await Promise.all(
      Array.from({ length: 9 }, (_, i) => actor(`p${i}`)),
    );
    const { data, error } = await service.rpc("certify_reservation_concurrency_fixture", {
      fixture_key: `concurrency-${nonce}`,
      patient_ids: patients.map((p) => p.id),
    });
    if (error) throw error;
    fixture = data as typeof fixture;
  }, 90_000);

  async function createBatch(quantityOnHand: number, label: string): Promise<string> {
    const batchId = randomUUID();
    const { error } = await service.from("inventory_batches").insert({
      id: batchId,
      organization_id: fixture.organizationId,
      pharmacy_location_id: fixture.pharmacyLocationId,
      medicine_id: fixture.medicineId,
      batch_number: `CONC-${label}-${nonce}`,
      expires_on: "2099-12-31",
      quantity_on_hand: quantityOnHand,
      unit: "tablet",
      status: "available",
      created_by: patients[0]!.id,
    });
    if (error) throw error;
    return batchId;
  }

  async function matchAndFetchMar(patientIndex: number, batchId: string): Promise<string> {
    const patient = patients[patientIndex]!;
    const marId = fixture.marIds[patientIndex]!;
    const matched = await patient.client.rpc("match_inventory", {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: `${marId}:match`,
      target_channel: "test",
      target_mar_id: marId,
      target_inventory_batch_id: batchId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
    });
    if (matched.error) throw matched.error;
    return marId;
  }

  function reserveArgs(patientIndex: number, marId: string, batchId: string, quantity: number, idempotencyKey: string) {
    const patient = patients[patientIndex]!;
    return {
      target_organization_id: fixture.organizationId,
      target_actor_id: patient.id,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_idempotency_key: idempotencyKey,
      target_channel: "test",
      target_mar_id: marId,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_inventory_batch_id: batchId,
      target_quantity: quantity,
      target_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  async function batchQuantities(batchId: string): Promise<{ quantity_on_hand: number; quantity_reserved: number }> {
    const { data, error } = await service
      .from("inventory_batches")
      .select("quantity_on_hand,quantity_reserved")
      .eq("id", batchId)
      .single();
    if (error) throw error;
    return data as { quantity_on_hand: number; quantity_reserved: number };
  }

  it("stock=1, two concurrent quantity-1 requests: exactly one succeeds, one fails, final stock is fully reserved, never oversold", async () => {
    const batchId = await createBatch(1, "race");
    const marA = await matchAndFetchMar(0, batchId);
    const marB = await matchAndFetchMar(1, batchId);

    const [resultA, resultB] = await Promise.all([
      patients[0]!.client.rpc("reserve_inventory", reserveArgs(0, marA, batchId, 1, `${marA}:race`)),
      patients[1]!.client.rpc("reserve_inventory", reserveArgs(1, marB, batchId, 1, `${marB}:race`)),
    ]);

    const outcomes = [resultA, resultB];
    const successes = outcomes.filter((r) => !r.error);
    const failures = outcomes.filter((r) => r.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const quantities = await batchQuantities(batchId);
    expect(quantities.quantity_on_hand).toBe(1);
    expect(quantities.quantity_reserved).toBe(1);
    expect(quantities.quantity_on_hand - quantities.quantity_reserved).toBe(0);
  });

  it("stock=2, two concurrent quantity-1 requests: both succeed, stock fully reserved, no oversell", async () => {
    const batchId = await createBatch(2, "two-units");
    const marA = await matchAndFetchMar(2, batchId);
    const marB = await matchAndFetchMar(3, batchId);

    const [resultA, resultB] = await Promise.all([
      patients[2]!.client.rpc("reserve_inventory", reserveArgs(2, marA, batchId, 1, `${marA}:two-units`)),
      patients[3]!.client.rpc("reserve_inventory", reserveArgs(3, marB, batchId, 1, `${marB}:two-units`)),
    ]);

    expect(resultA.error, JSON.stringify(resultA.error)).toBeNull();
    expect(resultB.error, JSON.stringify(resultB.error)).toBeNull();

    const quantities = await batchQuantities(batchId);
    expect(quantities.quantity_on_hand).toBe(2);
    expect(quantities.quantity_reserved).toBe(2);
  });

  it("stock=1, a request for quantity=2 is rejected and leaves stock untouched", async () => {
    const batchId = await createBatch(1, "insufficient");
    const marId = await matchAndFetchMar(4, batchId);

    const result = await patients[4]!.client.rpc(
      "reserve_inventory",
      reserveArgs(4, marId, batchId, 2, `${marId}:insufficient`),
    );
    expect(result.error).not.toBeNull();

    const quantities = await batchQuantities(batchId);
    expect(quantities.quantity_on_hand).toBe(1);
    expect(quantities.quantity_reserved).toBe(0);
  });

  it("same idempotency key replayed sequentially returns the original reservation, no duplicate lock", async () => {
    const batchId = await createBatch(1, "seq-replay");
    const marId = await matchAndFetchMar(5, batchId);
    const key = `${marId}:seq-replay`;

    const first = await patients[5]!.client.rpc("reserve_inventory", reserveArgs(5, marId, batchId, 1, key));
    expect(first.error, JSON.stringify(first.error)).toBeNull();

    const replay = await patients[5]!.client.rpc("reserve_inventory", reserveArgs(5, marId, batchId, 1, key));
    expect(replay.error, JSON.stringify(replay.error)).toBeNull();
    expect((replay.data as { id: string }).id).toBe((first.data as { id: string }).id);

    const quantities = await batchQuantities(batchId);
    expect(quantities.quantity_reserved).toBe(1);
  });

  it("same idempotency key fired concurrently collapses to exactly one reservation, never two", async () => {
    const batchId = await createBatch(1, "conc-replay");
    const marId = await matchAndFetchMar(6, batchId);
    const key = `${marId}:conc-replay`;

    const [first, second] = await Promise.all([
      patients[6]!.client.rpc("reserve_inventory", reserveArgs(6, marId, batchId, 1, key)),
      patients[6]!.client.rpc("reserve_inventory", reserveArgs(6, marId, batchId, 1, key)),
    ]);
    // Exactly one of the two calls may succeed on first contact; the loser
    // may either fail outright (racing the unique constraint) or -- if it
    // ran after the winner committed -- observe the existing reservation
    // and return it. Either way there must be no duplicate reservation.
    const succeeded = [first, second].filter((r) => !r.error);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(succeeded.map((r) => (r.data as { id: string }).id));
    expect(ids.size).toBe(1);

    const { data: reservationRows, error: reservationRowsError } = await service
      .from("reservations")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("idempotency_key", key);
    expect(reservationRowsError, JSON.stringify(reservationRowsError)).toBeNull();
    expect(reservationRows).toHaveLength(1);

    const quantities = await batchQuantities(batchId);
    expect(quantities.quantity_reserved).toBe(1);
  });

  it("expiring a reservation's lock restores capacity exactly once", async () => {
    const batchId = await createBatch(1, "expiry");
    const marId = await matchAndFetchMar(7, batchId);
    const key = `${marId}:expiry`;

    const reserved = await patients[7]!.client.rpc("reserve_inventory", reserveArgs(7, marId, batchId, 1, key));
    expect(reserved.error, JSON.stringify(reserved.error)).toBeNull();

    let quantities = await batchQuantities(batchId);
    expect(quantities.quantity_reserved).toBe(1);

    const reservationId = (reserved.data as { id: string }).id;
    const backdated = await service
      .from("inventory_locks")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("organization_id", fixture.organizationId)
      .eq("reservation_id", reservationId);
    expect(backdated.error, JSON.stringify(backdated.error)).toBeNull();

    const released = await service.rpc("release_expired_inventory_holds", { target_limit: 10 });
    expect(released.error, JSON.stringify(released.error)).toBeNull();

    quantities = await batchQuantities(batchId);
    expect(quantities.quantity_reserved).toBe(0);
    expect(quantities.quantity_on_hand).toBe(1);

    // A second worker pass over the same (already-expired) lock must not
    // restore capacity a second time -- it should find nothing left to do.
    const releasedAgain = await service.rpc("release_expired_inventory_holds", { target_limit: 10 });
    expect(releasedAgain.error, JSON.stringify(releasedAgain.error)).toBeNull();
    quantities = await batchQuantities(batchId);
    expect(quantities.quantity_reserved).toBe(0);
  });

  it("a patient who is not a member of the pharmacy's organization is rejected before any inventory effect", async () => {
    const batchId = await createBatch(1, "cross-tenant");
    const crossTenantPatient = patients[8]!;
    const anyOrgAMarId = fixture.marIds[0]!;

    const attempt = await crossTenantPatient.client.rpc(
      "reserve_inventory",
      reserveArgs(8, anyOrgAMarId, batchId, 1, `${anyOrgAMarId}:cross-tenant`),
    );
    expect(attempt.error).not.toBeNull();
    expect(attempt.error?.message).toContain("Tenant membership is invalid");

    const quantities = await batchQuantities(batchId);
    expect(quantities.quantity_on_hand).toBe(1);
    expect(quantities.quantity_reserved).toBe(0);
  });
});
