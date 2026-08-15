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
  ] as const;

  let fixture: {
    organizationId: string;
    reservations: Record<(typeof reservationKeys)[number], string>;
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

    const { data: transitions } = await service
      .from("fulfillment_transitions")
      .select("from_state,to_state,reason")
      .eq("reservation_id", reservationId);
    expect(transitions).toHaveLength(1);
    expect(transitions?.[0]).toMatchObject({ from_state: "pending", to_state: "confirmed", reason: null });
  });

  it("lifecycle: declines with a meaningful reason and releases the inventory lock", async () => {
    const reservationId = fixture.reservations["decline-happy"];
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

    const { data: lock } = await service
      .from("inventory_locks")
      .select("status,released_at")
      .eq("reservation_id", reservationId)
      .single();
    expect(lock?.status).toBe("released");
    expect(lock?.released_at).not.toBeNull();

    const { data: transition } = await service
      .from("fulfillment_transitions")
      .select("reason")
      .eq("reservation_id", reservationId)
      .single();
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

    const { data: stillPending } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
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

    const { data: stillPending } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
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

    const { data: invisible } = await otherTenantPharmacist.client
      .from("reservations")
      .select("id")
      .eq("id", reservationId);
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
    await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });

    const code = generatePickupCode();
    const ready = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:ready`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(code),
    });
    expect(ready.error).toBeNull();
    const readyData = ready.data as ReservationRow;
    expect(readyData.isNewTransition).toBe(true);
    expect(readyData.pickup_code_hash).toBeUndefined();

    const wrongAttempt = await pharmacyStaff.client.rpc("collect_reservation", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: `${reservationId}:collect-wrong`,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode("WRONGCODE"),
    });
    expect(wrongAttempt.error?.message).toMatch(/pickup credential is invalid/i);

    const { data: stillReady } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
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

    const { data: lock } = await service
      .from("inventory_locks")
      .select("status,consumed_at")
      .eq("reservation_id", reservationId)
      .single();
    expect(lock?.status).toBe("consumed");
    expect(lock?.consumed_at).not.toBeNull();
  });

  it("idempotency: replaying mark_reservation_ready never rotates the stored credential hash", async () => {
    const reservationId = fixture.reservations["ready-replay"];
    await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });

    const originalCode = generatePickupCode();
    const idempotencyKey = `${reservationId}:ready`;
    const first = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: idempotencyKey,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(originalCode),
    });
    expect((first.data as ReservationRow).isNewTransition).toBe(true);

    const discardedReplayCode = generatePickupCode();
    const replay = await pharmacyStaff.client.rpc("mark_reservation_ready", {
      ...baseArgs(pharmacyStaff.id),
      target_idempotency_key: idempotencyKey,
      target_reservation_id: reservationId,
      target_pickup_code_hash: hashPickupCode(discardedReplayCode),
    });
    expect(replay.error).toBeNull();
    expect((replay.data as ReservationRow).isNewTransition).toBe(false);

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
      target_pickup_code_hash: hashPickupCode(generatePickupCode()),
    });
    expect(skipToReady.error?.message).toMatch(/only a confirmed reservation/i);

    const { data: stillPending } = await service
      .from("reservations")
      .select("status")
      .eq("id", reservationId)
      .single();
    expect(stillPending?.status).toBe("pending");

    const confirmed = await pharmacist.client.rpc("decide_reservation", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${reservationId}:confirmed`,
      target_reservation_id: reservationId,
      target_status: "confirmed",
    });
    expect(confirmed.error).toBeNull();
  });
});
