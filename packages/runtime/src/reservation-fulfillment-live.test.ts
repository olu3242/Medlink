import { createHash, randomInt, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

interface ReservationRow {
  readonly id: string;
  readonly status: string;
  readonly confirmed_at: string | null;
  readonly cancelled_at: string | null;
  readonly collected_at: string | null;
  readonly pickup_code_hash?: string | null;
  readonly isNewTransition?: boolean;
}

const PICKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generatePickupCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += PICKUP_ALPHABET[randomInt(PICKUP_ALPHABET.length)];
  return code;
}
function hashPickupCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

live("live reservation fulfillment lifecycle", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Not created eagerly here: describe.skip still executes this factory body
  // during test collection even when the live env vars are absent, so
  // createClient(url!, ...) would throw on the very first (unskipped)
  // import of this file. It is created inside beforeAll instead, which
  // describe.skip does not run.
  let service: SupabaseClient;

  interface Actor {
    readonly id: string;
    readonly client: SupabaseClient;
  }

  async function actor(label: string): Promise<Actor> {
    const email = `fulfillment-${label}-${nonce}@medlink.test`;
    const password = `Fulfillment-${nonce}-Strong!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`fixture actor "${label}" was not created`);
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error(`fixture actor "${label}" could not sign in`);
    }
    return { id: created.data.user.id, client };
  }

  const reservationKeys = [
    "confirm-happy",
    "decline-happy",
    "rollback-reason",
    "wrong-role",
    "cross-tenant",
    "concurrency",
    "ready-collect",
    "ready-replay",
    "invalid-transition",
    "collection-race",
    "credential-authority",
    "credential-missing",
    "expiry-target",
    "outbox-race",
  ] as const;

  let fixture: {
    organizationId: string;
    pharmacyLocationId: string;
    inventoryBatchId: string;
    reservations: Record<(typeof reservationKeys)[number], string>;
    scarceInventoryBatchId: string;
    scarceMarIds: readonly [string, string];
  };
  let patient: Actor;
  let pharmacist: Actor;
  let pharmacyStaff: Actor;
  let wrongRole: Actor;
  let otherTenantPharmacist: Actor;
  let otherTenantPatient: Actor;

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    [patient, pharmacist, pharmacyStaff, wrongRole, otherTenantPharmacist, otherTenantPatient] =
      await Promise.all([
        actor("patient"),
        actor("pharmacist"),
        actor("pharmacy-staff"),
        actor("wrong-role"),
        actor("other-pharmacist"),
        actor("other-patient"),
      ]);
    const { data, error } = await service.rpc("certify_reservation_fulfillment_fixture", {
      fixture_key: `fulfill-${nonce}`,
      patient_id: patient.id,
      pharmacist_id: pharmacist.id,
      pharmacy_staff_id: pharmacyStaff.id,
      wrong_role_id: wrongRole.id,
      other_tenant_pharmacist_id: otherTenantPharmacist.id,
      other_tenant_patient_id: otherTenantPatient.id,
      reservation_keys: reservationKeys,
    });
    if (error) throw error;
    fixture = data as typeof fixture;
  }, 60_000);

  function baseArgs(actorId: string) {
    return {
      target_organization_id: fixture.organizationId,
      target_actor_id: actorId,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_channel: "test",
    };
  }

  it("lifecycle: confirms a pending reservation with actor attribution and no reason, and replay is idempotent", async () => {
    const reservationId = fixture.reservations["confirm-happy"];
    const idempotencyKey = `${reservationId}:confirmed`;

    const first = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: idempotencyKey,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(first.error).toBeNull();
    const confirmed = first.data as ReservationRow;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmed_at).not.toBeNull();

    const replay = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: idempotencyKey,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(replay.error).toBeNull();
    expect((replay.data as ReservationRow).status).toBe("confirmed");

    const { data: transitions, error: transitionsError } = await service
      .from("fulfillment_transitions")
      .select("from_state,to_state,reason")
      .eq("reservation_id", reservationId);
    expect(transitionsError, JSON.stringify(transitionsError)).toBeNull();
    expect(transitions).toHaveLength(1);
    expect(transitions?.[0]).toMatchObject({ from_state: "pending", to_state: "confirmed", reason: null });
  });

  it("lifecycle: declines with a meaningful reason and releases the inventory lock, restoring availability", async () => {
    const reservationId = fixture.reservations["decline-happy"];
    const { data: before, error: beforeError } = await service
      .from("inventory_batches")
      .select("quantity_reserved")
      .eq("id", fixture.inventoryBatchId)
      .single();
    expect(beforeError, JSON.stringify(beforeError)).toBeNull();

    const { error, data } = await pharmacyStaff.client.rpc("decide_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:cancelled`,
      target_reservation_id: reservationId,
      target_status: "cancelled",
      target_reason: "Patient no longer needs this medication",
    });
    expect(error).toBeNull();
    const cancelled = data as ReservationRow;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled_at).not.toBeNull();

    const { data: lock, error: lockError } = await service
      .from("inventory_locks")
      .select("status,released_at")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockError, JSON.stringify(lockError)).toBeNull();
    expect(lock?.status).toBe("released");
    expect(lock?.released_at).not.toBeNull();

    const { data: after, error: afterError } = await service
      .from("inventory_batches")
      .select("quantity_reserved")
      .eq("id", fixture.inventoryBatchId)
      .single();
    expect(afterError, JSON.stringify(afterError)).toBeNull();
    expect(after?.quantity_reserved).toBe((before?.quantity_reserved ?? 0) - 1);

    const { data: transition, error: transitionError } = await service
      .from("fulfillment_transitions")
      .select("reason")
      .eq("reservation_id", reservationId)
      .single();
    expect(transitionError, JSON.stringify(transitionError)).toBeNull();
    expect(transition?.reason).toBe("Patient no longer needs this medication");
  });

  it("rollback: a reasonless cancel is rejected at the database and leaves the reservation pending for a later valid decision", async () => {
    const reservationId = fixture.reservations["rollback-reason"];
    const rejected = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:cancelled-invalid`,
      target_reservation_id: reservationId,
      target_status: "cancelled",
    });
    expect(rejected.error?.message).toMatch(/meaningful reason/i);

    const { data: stillPending, error: stillPendingError } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
    expect(stillPendingError, JSON.stringify(stillPendingError)).toBeNull();
    expect(stillPending?.status).toBe("pending");

    const confirmed = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(confirmed.error).toBeNull();
    expect((confirmed.data as ReservationRow).status).toBe("confirmed");
  });

  it("isolation: a patient and a non-pharmacy role cannot decide a reservation, but the correct role still can", async () => {
    const reservationId = fixture.reservations["wrong-role"];

    const asPatient = await patient.client.rpc("decide_reservation", {
      ...baseArgs(patient.id),
      target_idempotency_key: `${reservationId}:confirmed-by-patient`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(asPatient.error?.message).toMatch(/requires pharmacy staff or pharmacist role/i);

    const asWrongRole = await wrongRole.client.rpc("decide_reservation", {
      ...baseArgs(wrongRole.id),
      target_idempotency_key: `${reservationId}:confirmed-by-wrong-role`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(asWrongRole.error?.message).toMatch(/requires pharmacy staff or pharmacist role/i);

    const { data: stillPending, error: stillPendingError } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
    expect(stillPendingError, JSON.stringify(stillPendingError)).toBeNull();
    expect(stillPending?.status).toBe("pending");

    const asPharmacyStaff = await pharmacyStaff.client.rpc("decide_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:confirmed-by-staff`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(asPharmacyStaff.error).toBeNull();
    expect((asPharmacyStaff.data as ReservationRow).status).toBe("confirmed");
  });

  it("isolation: a pharmacist from another tenant cannot decide or even see the reservation", async () => {
    const reservationId = fixture.reservations["cross-tenant"];

    const asOtherTenant = await otherTenantPharmacist.client.rpc("decide_reservation", {
      ...baseArgs(otherTenantPharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed-by-outsider`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(asOtherTenant.error?.message).toMatch(/requires pharmacy staff or pharmacist role/i);

    const { data: invisible, error: invisibleError } = await otherTenantPharmacist.client
      .from("reservations")
      .select("id")
      .eq("id", reservationId);
    expect(invisibleError, JSON.stringify(invisibleError)).toBeNull();
    expect(invisible).toEqual([]);

    const asPharmacist = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(asPharmacist.error).toBeNull();
  });

  it("concurrency: two simultaneous decisions on the same pending reservation -- exactly one wins", async () => {
    const reservationId = fixture.reservations.concurrency;

    const settled = await Promise.allSettled([
      pharmacist.client.rpc("decide_reservation", {
        ...baseArgs(pharmacist.id),
        target_idempotency_key: `${reservationId}:race-confirm`,
        target_reservation_id: reservationId,
        target_status: "confirmed",
      }),
      pharmacyStaff.client.rpc("decide_reservation", {
        ...baseArgs(pharmacyStaff.id),
        target_idempotency_key: `${reservationId}:race-cancel`,
        target_reservation_id: reservationId,
        target_status: "cancelled",
        target_reason: "Racing cancellation attempt",
      }),
    ]);
    const outcomes = settled.map((result) =>
      result.status === "fulfilled" ? result.value : { data: null, error: result.reason as Error },
    );
    const successes = outcomes.filter((outcome) => !outcome.error);
    const failures = outcomes.filter((outcome) => outcome.error);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error?.message)).toMatch(/only a pending reservation/i);
  });

  it("lifecycle: ready then collect with the correct pickup credential; a wrong credential is rejected first without side effects", async () => {
    const reservationId = fixture.reservations["ready-collect"];
    const confirmed = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(confirmed.error).toBeNull();

    const { data: lockAfterConfirm, error: lockAfterConfirmError } = await service
      .from("inventory_locks")
      .select("status")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockAfterConfirmError, JSON.stringify(lockAfterConfirmError)).toBeNull();
    expect(lockAfterConfirm?.status).toBe("active");

    const ready = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:ready`,
      target_reservation_id: reservationId,
    });
    expect(ready.error).toBeNull();
    const readyData = ready.data as ReservationRow;
    expect(readyData.status).toBe("ready");
    expect(readyData.pickup_code_hash).toBeUndefined();

    const { data: lockAfterReady, error: lockAfterReadyError } = await service
      .from("inventory_locks")
      .select("status")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockAfterReadyError, JSON.stringify(lockAfterReadyError)).toBeNull();
    expect(lockAfterReady?.status).toBe("active");

    // Readiness carries no credential -- the patient issues their own,
    // client-side-generated code once the reservation is ready.
    const code = generatePickupCode();
    const issued = await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: `${reservationId}:credential_issued`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(code),
    });
    expect(issued.error).toBeNull();
    expect((issued.data as ReservationRow).pickup_code_hash).toBeUndefined();

    const wrongAttempt = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect-wrong`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode("WRONGCODE"),
    });
    expect(wrongAttempt.error?.message).toMatch(/pickup credential is invalid/i);

    const { data: stillReady, error: stillReadyError } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
    expect(stillReadyError, JSON.stringify(stillReadyError)).toBeNull();
    expect(stillReady?.status).toBe("ready");

    const collected = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(code),
    });
    expect(collected.error).toBeNull();
    const collectedData = collected.data as ReservationRow;
    expect(collectedData.status).toBe("collected");
    expect(collectedData.pickup_code_hash).toBeUndefined();

    const { data: lock, error: lockError } = await service
      .from("inventory_locks")
      .select("status,consumed_at")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockError, JSON.stringify(lockError)).toBeNull();
    expect(lock?.status).toBe("consumed");
    expect(lock?.consumed_at).not.toBeNull();
  });

  it("idempotency: replaying mark_reservation_ready is a stable no-op, and re-replaying issue_pickup_credential never rotates the stored hash", async () => {
    const reservationId = fixture.reservations["ready-replay"];
    await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });

    const readyIdempotencyKey = `${reservationId}:ready`;
    const readyFirst = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: readyIdempotencyKey,
      target_reservation_id: reservationId,
    });
    expect(readyFirst.error).toBeNull();
    expect((readyFirst.data as ReservationRow).status).toBe("ready");
    const readyReplay = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: readyIdempotencyKey,
      target_reservation_id: reservationId,
    });
    expect(readyReplay.error).toBeNull();
    expect((readyReplay.data as ReservationRow).status).toBe("ready");

    const originalCode = generatePickupCode();
    const credentialIdempotencyKey = `${reservationId}:credential_issued`;
    const first = await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: credentialIdempotencyKey,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(originalCode),
    });
    expect(first.error).toBeNull();

    // Exact replay: identical key, identical hash -> succeeds as a no-op.
    const exactReplay = await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: credentialIdempotencyKey,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(originalCode),
    });
    expect(exactReplay.error).toBeNull();

    // Conflicting replay: identical key, a different (freshly generated)
    // hash -> rejected, never silently rotated.
    const discardedReplayCode = generatePickupCode();
    const conflictingReplay = await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: credentialIdempotencyKey,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(discardedReplayCode),
    });
    expect(conflictingReplay.error?.message).toMatch(/already used to issue a different pickup credential/i);

    // Only the original code -- the one actually persisted -- still collects.
    const collected = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(originalCode),
    });
    expect(collected.error).toBeNull();
    expect((collected.data as ReservationRow).status).toBe("collected");
  });

  it("invalid transitions: ready/collect cannot skip ahead of a pending reservation, which remains decidable afterward", async () => {
    const reservationId = fixture.reservations["invalid-transition"];

    const skipToCollect = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect-too-early`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(generatePickupCode()),
    });
    expect(skipToCollect.error?.message).toMatch(/only a reservation marked ready/i);

    const skipToReady = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:ready-too-early`,
      target_reservation_id: reservationId,
    });
    expect(skipToReady.error?.message).toMatch(/only a confirmed reservation/i);

    // A pickup credential cannot be issued before the reservation is ready,
    // even by the reservation's own patient.
    const creditBeforeReady = await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: `${reservationId}:credential-too-early`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(generatePickupCode()),
    });
    expect(creditBeforeReady.error?.message).toMatch(/may only be issued once a reservation is ready/i);

    const { data: stillPending, error: stillPendingError } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
    expect(stillPendingError, JSON.stringify(stillPendingError)).toBeNull();
    expect(stillPending?.status).toBe("pending");

    const confirmed = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(confirmed.error).toBeNull();
  });

  it("concurrency: two competing reservations for the last unit of real stock -- exactly one wins, no oversell", async () => {
    const [marA, marB] = fixture.scarceMarIds;
    const reserve = (marId: string) =>
      pharmacist.client.rpc("reserve_inventory", {
        ...baseArgs(pharmacist.id),
        target_idempotency_key: `${marId}:reserve`,
        target_mar_id: marId,
        target_pharmacy_location_id: fixture.pharmacyLocationId,
        target_inventory_batch_id: fixture.scarceInventoryBatchId,
        target_quantity: 1,
        target_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });

    const settled = await Promise.allSettled([reserve(marA), reserve(marB)]);
    const outcomes = settled.map((result) =>
      result.status === "fulfilled" ? result.value : { data: null, error: result.reason as Error },
    );
    const successes = outcomes.filter((outcome) => !outcome.error);
    const failures = outcomes.filter((outcome) => outcome.error);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error?.message)).toMatch(/insufficient|unavailable/i);

    const { data: batch, error: batchError } = await service
      .from("inventory_batches")
      .select("quantity_on_hand,quantity_reserved")
      .eq("id", fixture.scarceInventoryBatchId)
      .single();
    expect(batchError, JSON.stringify(batchError)).toBeNull();
    expect(batch?.quantity_reserved).toBe(1);
    expect(batch?.quantity_reserved).toBeLessThanOrEqual(batch?.quantity_on_hand ?? 0);

    const { data: locks, error: locksError } = await service
      .from("inventory_locks")
      .select("id")
      .eq("inventory_batch_id", fixture.scarceInventoryBatchId)
      .eq("status", "active");
    expect(locksError, JSON.stringify(locksError)).toBeNull();
    expect(locks).toHaveLength(1);

    // The winning reserve_inventory call also transitions the MAR
    // matched -> reserved, which no other test in this suite exercises
    // (every other reservation is seeded directly at 'pending' by the
    // fixture). Exactly one of the two MARs should have made that
    // transition.
    const { data: winningMars, error: marsError } = await service
      .from("medication_access_requests")
      .select("id,state")
      .in("id", [marA, marB]);
    expect(marsError, JSON.stringify(marsError)).toBeNull();
    expect(winningMars?.filter((mar) => mar.state === "reserved")).toHaveLength(1);
    expect(winningMars?.filter((mar) => mar.state === "matched")).toHaveLength(1);
  });

  it("concurrency: two simultaneous collection attempts on the same ready reservation -- exactly one effective collection", async () => {
    const reservationId = fixture.reservations["collection-race"];
    await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:ready`,
      target_reservation_id: reservationId,
    });
    const code = generatePickupCode();
    await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: `${reservationId}:credential_issued`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(code),
    });

    const collect = (suffix: string) =>
      pharmacyStaff.client.rpc("collect_reservation", {
        ...baseArgs(pharmacyStaff.id),
        target_idempotency_key: `${reservationId}:collect-${suffix}`,
        target_reservation_id: reservationId,
        target_pickup_code_hash: hashPickupCode(code),
      });

    const settled = await Promise.allSettled([collect("a"), collect("b")]);
    const outcomes = settled.map((result) =>
      result.status === "fulfilled" ? result.value : { data: null, error: result.reason as Error },
    );
    const successes = outcomes.filter((outcome) => !outcome.error);
    const failures = outcomes.filter((outcome) => outcome.error);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.error?.message)).toMatch(/only a reservation marked ready/i);

    const { data: transitions, error: transitionsError } = await service
      .from("fulfillment_transitions")
      .select("to_state")
      .eq("reservation_id", reservationId)
      .eq("to_state", "collected");
    expect(transitionsError, JSON.stringify(transitionsError)).toBeNull();
    expect(transitions).toHaveLength(1);

    const { data: lock, error: lockError } = await service
      .from("inventory_locks")
      .select("status")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockError, JSON.stringify(lockError)).toBeNull();
    expect(lock?.status).toBe("consumed");
  });

  it("isolation: only the reservation's own patient may issue its pickup credential, and the plaintext never appears in the reservation row, the outbox, the audit trail, or the transition log", async () => {
    const reservationId = fixture.reservations["credential-authority"];
    await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:ready`,
      target_reservation_id: reservationId,
    });

    const attemptHash = hashPickupCode(generatePickupCode());

    const asOtherPatient = await otherTenantPatient.client.rpc("issue_pickup_credential", {
      ...baseArgs(otherTenantPatient.id),
      target_idempotency_key: `${reservationId}:credential-by-other-patient`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: attemptHash,
    });
    expect(asOtherPatient.error?.message).toMatch(/only the reservation's own patient/i);

    const asPharmacist = await pharmacist.client.rpc("issue_pickup_credential", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:credential-by-pharmacist`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: attemptHash,
    });
    expect(asPharmacist.error?.message).toMatch(/only the reservation's own patient/i);

    const asPharmacyStaff = await pharmacyStaff.client.rpc("issue_pickup_credential", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:credential-by-pharmacy-staff`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: attemptHash,
    });
    expect(asPharmacyStaff.error?.message).toMatch(/only the reservation's own patient/i);

    const { data: stillNoCredential, error: stillNoCredentialError } = await service
      .from("reservations")
      .select("pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(stillNoCredentialError, JSON.stringify(stillNoCredentialError)).toBeNull();
    expect(stillNoCredential?.pickup_code_hash).toBeNull();

    // A distinguishable plaintext (not just a random code) so it can be
    // searched for by literal substring below -- proving it was never
    // persisted anywhere, not merely that a same-shaped value wasn't.
    const distinguishablePlaintext = `AUDITPROOF${Date.now().toString(36).toUpperCase()}`;
    const issued = await patient.client.rpc("issue_pickup_credential", {
      ...baseArgs(patient.id),
      target_idempotency_key: `${reservationId}:credential_issued`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(distinguishablePlaintext),
    });
    expect(issued.error).toBeNull();

    // Checked right after issuance, before collection consumes it: the
    // stored value is a 64-char hex hash, never the plaintext itself.
    const { data: issuedRow, error: issuedRowError } = await service
      .from("reservations")
      .select("pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(issuedRowError, JSON.stringify(issuedRowError)).toBeNull();
    expect(issuedRow?.pickup_code_hash).not.toContain(distinguishablePlaintext);
    expect(issuedRow?.pickup_code_hash).toMatch(/^[0-9a-f]{64}$/);

    const collected = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(distinguishablePlaintext),
    });
    expect(collected.error).toBeNull();
    expect((collected.data as ReservationRow).status).toBe("collected");

    // collect_reservation nulls pickup_code_hash on collection -- the
    // credential is consumed/unusable afterward, not merely matched.
    const { data: reservationRow, error: reservationRowError } = await service
      .from("reservations")
      .select("pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(reservationRowError, JSON.stringify(reservationRowError)).toBeNull();
    expect(reservationRow?.pickup_code_hash).toBeNull();

    const { data: outboxRows, error: outboxError } = await service
      .from("runtime_outbox_events")
      .select("payload")
      .eq("aggregate_id", reservationId);
    expect(outboxError, JSON.stringify(outboxError)).toBeNull();
    for (const row of outboxRows ?? []) {
      expect(JSON.stringify(row.payload)).not.toContain(distinguishablePlaintext);
    }

    const { data: auditRows, error: auditError } = await service
      .from("governance_audit_events")
      .select("previous_state,new_state,metadata")
      .eq("resource_id", reservationId);
    expect(auditError, JSON.stringify(auditError)).toBeNull();
    for (const row of auditRows ?? []) {
      expect(JSON.stringify(row)).not.toContain(distinguishablePlaintext);
    }

    const { data: transitionRows, error: transitionError } = await service
      .from("fulfillment_transitions")
      .select("*")
      .eq("reservation_id", reservationId);
    expect(transitionError, JSON.stringify(transitionError)).toBeNull();
    for (const row of transitionRows ?? []) {
      expect(JSON.stringify(row)).not.toContain(distinguishablePlaintext);
    }
  });

  it("collection fails closed when no pickup credential has ever been issued, leaving the reservation ready", async () => {
    const reservationId = fixture.reservations["credential-missing"];
    await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:ready`,
      target_reservation_id: reservationId,
    });

    const attempt = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect-no-credential`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(generatePickupCode()),
    });
    expect(attempt.error?.message).toMatch(/pickup credential is invalid/i);

    const { data: stillReady, error: stillReadyError } = await service
      .from("reservations")
      .select("status,pickup_code_hash")
      .eq("id", reservationId)
      .single();
    expect(stillReadyError, JSON.stringify(stillReadyError)).toBeNull();
    expect(stillReady?.status).toBe("ready");
    expect(stillReady?.pickup_code_hash).toBeNull();
  });

  it("expiry: an overdue pending reservation is released atomically, restoring availability, with an audit transition", async () => {
    const reservationId = fixture.reservations["expiry-target"];

    const { data: lockBefore, error: lockBeforeError } = await service
      .from("inventory_locks")
      .select("id,created_at")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockBeforeError, JSON.stringify(lockBeforeError)).toBeNull();

    const { data: batchBefore, error: batchBeforeError } = await service
      .from("inventory_batches")
      .select("quantity_reserved")
      .eq("id", fixture.inventoryBatchId)
      .single();
    expect(batchBeforeError, JSON.stringify(batchBeforeError)).toBeNull();

    // Backdate this one lock past its deadline -- fixture setup, not a
    // substitute for the RPC's own behavior under test. Must stay after
    // the lock's own created_at (inventory_locks_check requires
    // expires_at > created_at); a 1ms offset is enough margin since the
    // RPC call below is itself a separate, later network round trip.
    const backdatedExpiry = new Date(
      new Date(lockBefore?.created_at as string).getTime() + 1,
    ).toISOString();
    const { error: backdateError } = await service
      .from("inventory_locks")
      .update({ expires_at: backdatedExpiry })
      .eq("id", lockBefore?.id);
    expect(backdateError, JSON.stringify(backdateError)).toBeNull();

    const { data: result, error: expiryError } = await service.rpc(
      "release_expired_inventory_holds",
      { target_limit: 50 },
    );
    expect(expiryError, JSON.stringify(expiryError)).toBeNull();
    expect((result as { releasedHolds: number }).releasedHolds).toBeGreaterThanOrEqual(1);

    const { data: reservation, error: reservationError } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
    expect(reservationError, JSON.stringify(reservationError)).toBeNull();
    expect(reservation?.status).toBe("expired");

    const { data: lockAfter, error: lockAfterError } = await service
      .from("inventory_locks")
      .select("status,released_at")
      .eq("reservation_id", reservationId)
      .single();
    expect(lockAfterError, JSON.stringify(lockAfterError)).toBeNull();
    expect(lockAfter?.status).toBe("expired");
    expect(lockAfter?.released_at).not.toBeNull();

    const { data: batchAfter, error: batchAfterError } = await service
      .from("inventory_batches")
      .select("quantity_reserved")
      .eq("id", fixture.inventoryBatchId)
      .single();
    expect(batchAfterError, JSON.stringify(batchAfterError)).toBeNull();
    expect(batchAfter?.quantity_reserved).toBe((batchBefore?.quantity_reserved ?? 0) - 1);

    const { data: transition, error: transitionError } = await service
      .from("fulfillment_transitions")
      .select("from_state,to_state,step")
      .eq("reservation_id", reservationId)
      .single();
    expect(transitionError, JSON.stringify(transitionError)).toBeNull();
    expect(transition).toMatchObject({ from_state: "pending", to_state: "expired", step: "system.expired" });

    // Replay safety: a second run must not double-count or error on the
    // idempotency key collision (unique constraint + ON CONFLICT DO NOTHING).
    const replay = await service.rpc("release_expired_inventory_holds", { target_limit: 50 });
    expect(replay.error).toBeNull();
  });

  it("outbox claim race: two workers racing for the same eligible event -- exactly one owns it", async () => {
    const reservationId = fixture.reservations["outbox-race"];
    const confirmed = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(confirmed.error).toBeNull();

    const { data: pendingEvent, error: pendingEventError } = await service
      .from("runtime_outbox_events")
      .select("id")
      .eq("aggregate_id", reservationId)
      .eq("event_type", "reservation.confirmed.v1")
      .single();
    expect(pendingEventError, JSON.stringify(pendingEventError)).toBeNull();

    const claim = (worker: string) =>
      service.rpc("claim_runtime_outbox_events", { target_worker: worker, target_limit: 50 });

    const [claimA, claimB] = await Promise.all([claim("race-worker-a"), claim("race-worker-b")]);
    expect(claimA.error).toBeNull();
    expect(claimB.error).toBeNull();

    const claimedA = ((claimA.data ?? []) as Array<{ id: string }>)
      .filter((row) => row.id === pendingEvent?.id);
    const claimedB = ((claimB.data ?? []) as Array<{ id: string }>)
      .filter((row) => row.id === pendingEvent?.id);
    expect(claimedA.length + claimedB.length).toBe(1);

    const { data: locked, error: lockedError } = await service
      .from("runtime_outbox_events")
      .select("status,locked_by")
      .eq("id", pendingEvent?.id)
      .single();
    expect(lockedError, JSON.stringify(lockedError)).toBeNull();
    expect(locked?.status).toBe("publishing");
    expect(["race-worker-a", "race-worker-b"]).toContain(locked?.locked_by);
  });
});
