import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import {
  collectReservation,
  collectReservationSchema,
  decideReservation,
  listReservations,
  markReservationReady,
  reservationDecisionSchema,
  reservationListQuerySchema,
} from "./reservations";

const context: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "pharmacy_staff",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

const reservationId = "00000000-0000-4000-8000-000000000003";

describe("reservationDecisionSchema", () => {
  it("accepts confirm without a reason", () => {
    expect(reservationDecisionSchema.safeParse({ status: "confirmed" }).success).toBe(true);
  });

  it("accepts confirm with an optional reason", () => {
    expect(
      reservationDecisionSchema.safeParse({ status: "confirmed", reason: "Verified in person" }).success,
    ).toBe(true);
  });

  it("rejects decline without a reason", () => {
    expect(reservationDecisionSchema.safeParse({ status: "declined" }).success).toBe(false);
  });

  it("rejects decline with a whitespace-only reason", () => {
    expect(
      reservationDecisionSchema.safeParse({ status: "declined", reason: "   " }).success,
    ).toBe(false);
  });

  it("rejects decline with a reason shorter than 3 characters", () => {
    expect(reservationDecisionSchema.safeParse({ status: "declined", reason: "no" }).success)
      .toBe(false);
  });

  it("accepts decline with a meaningful reason", () => {
    expect(
      reservationDecisionSchema.safeParse({ status: "declined", reason: "Out of stock" }).success,
    ).toBe(true);
  });

  it("rejects an unsupported status", () => {
    expect(reservationDecisionSchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});

function fakeDatabase(rpcResult: { data: unknown; error: unknown }) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const database = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  };
  return { database: database as unknown as SupabaseClient, rpcCalls };
}

describe("decideReservation", () => {
  it("maps a confirm decision to target_status 'confirmed' with a null reason when none is supplied", async () => {
    const { database, rpcCalls } = fakeDatabase({ data: { id: reservationId, status: "confirmed" }, error: null });
    await decideReservation(context, database, reservationId, { status: "confirmed" });
    expect(rpcCalls[0]).toMatchObject({
      fn: "decide_reservation",
      args: {
        target_organization_id: context.organizationId,
        target_actor_id: context.userId,
        target_idempotency_key: `${reservationId}:confirmed`,
        target_reservation_id: reservationId,
        target_status: "confirmed",
        target_reason: null,
      },
    });
  });

  it("maps a decline decision to the canonical 'cancelled' status, never a persisted 'declined'", async () => {
    const { database, rpcCalls } = fakeDatabase({ data: { id: reservationId, status: "cancelled" }, error: null });
    await decideReservation(context, database, reservationId, { status: "declined", reason: "Out of stock" });
    expect(rpcCalls[0]).toMatchObject({
      fn: "decide_reservation",
      args: {
        target_idempotency_key: `${reservationId}:cancelled`,
        target_status: "cancelled",
        target_reason: "Out of stock",
      },
    });
  });

  it("rejects a decline with no reason before ever calling the RPC (defense in depth alongside the schema refine)", async () => {
    const { database, rpcCalls } = fakeDatabase({ data: null, error: null });
    await expect(
      decideReservation(context, database, reservationId, { status: "declined" } as never),
    ).rejects.toMatchObject({ category: "validation", code: "reason_required" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("throws an infrastructure RuntimeError on an RPC failure, not the raw Postgres error", async () => {
    const { database } = fakeDatabase({ data: null, error: { message: "reservation not found" } });
    await expect(
      decideReservation(context, database, reservationId, { status: "confirmed" }),
    ).rejects.toMatchObject({ category: "infrastructure", status: 503 });
  });
});

describe("reservationListQuerySchema", () => {
  it("accepts an empty query -- listReservations defaults limit to 20 itself", () => {
    expect(reservationListQuerySchema.parse({})).toEqual({});
  });

  it("accepts pending/confirmed/ready but rejects a terminal status", () => {
    expect(reservationListQuerySchema.safeParse({ status: "ready" }).success).toBe(true);
    expect(reservationListQuerySchema.safeParse({ status: "collected" }).success).toBe(false);
  });

  it("bounds limit to 50", () => {
    expect(reservationListQuerySchema.safeParse({ limit: "999" }).success).toBe(false);
  });
});

function fakeListDatabase(rows: readonly unknown[]) {
  const calls: string[] = [];
  const builder = {
    eq: (column: string, value: unknown) => { calls.push(`eq:${column}=${value}`); return builder; },
    order: () => builder,
    limit: (n: number) => { calls.push(`limit:${n}`); return builder; },
    lt: (column: string, value: unknown) => { calls.push(`lt:${column}<${value}`); return builder; },
    then: (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
  };
  const database = { from: () => ({ select: () => builder }) };
  return { database: database as unknown as SupabaseClient, calls };
}

describe("listReservations", () => {
  it("scopes the query to the caller's own organization and maps rows to the minimized inbox DTO", async () => {
    const { database, calls } = fakeListDatabase([{
      id: reservationId, status: "confirmed", patient_id: "patient-1",
      created_at: "2026-01-01T00:00:00Z", confirmed_at: "2026-01-01T00:01:00Z",
      expires_at: "2026-01-02T00:00:00Z",
      pharmacy_location: { id: "loc-1", name: "Main Street" },
      inventory_locks: [{ quantity: 2, inventory_batch: { medicine: { brand_name: "Amoxil", generic_name: null } } }],
    }]);
    const rows = await listReservations(context, database, reservationListQuerySchema.parse({}));
    expect(calls).toContain(`eq:organization_id=${context.organizationId}`);
    expect(rows).toEqual([{
      id: reservationId, status: "confirmed", patientId: "patient-1",
      medicineName: "Amoxil", pharmacyLocationName: "Main Street", quantity: 2,
      createdAt: "2026-01-01T00:00:00Z", confirmedAt: "2026-01-01T00:01:00Z",
      expiresAt: "2026-01-02T00:00:00Z",
    }]);
  });

  it("exposes no raw Greenbook/NRN identity and no patient contact PII -- only the opaque patientId", async () => {
    const { database } = fakeListDatabase([{
      id: reservationId, status: "confirmed", patient_id: "patient-1",
      created_at: "2026-01-01T00:00:00Z", confirmed_at: null, expires_at: "2026-01-02T00:00:00Z",
      pharmacy_location: null, inventory_locks: [],
    }]);
    const [entry] = await listReservations(context, database, reservationListQuerySchema.parse({}));
    expect(Object.keys(entry as object).sort()).toEqual(
      ["confirmedAt", "createdAt", "expiresAt", "id", "medicineName", "patientId",
        "pharmacyLocationName", "quantity", "status"],
    );
  });
});

function fakeRpcOnlyDatabase(rpcResult: { data: unknown; error: unknown }) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const database = {
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcResult; },
  };
  return { database: database as unknown as SupabaseClient, rpcCalls };
}

describe("markReservationReady", () => {
  it("sends only a 64-hex-char hash to the RPC, never the generated plaintext", async () => {
    const { database, rpcCalls } = fakeRpcOnlyDatabase({
      data: { id: reservationId, status: "ready", isNewTransition: true }, error: null,
    });
    const result = await markReservationReady(context, database, reservationId);
    const sentHash = rpcCalls[0]?.args.target_pickup_code_hash as string;
    expect(sentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.pickupCode).toBeDefined();
    expect(result.pickupCode).not.toBe(sentHash);
  });

  it("omits pickupCode from the result when the RPC reports a replay (isNewTransition: false)", async () => {
    const { database } = fakeRpcOnlyDatabase({
      data: { id: reservationId, status: "ready", isNewTransition: false }, error: null,
    });
    const result = await markReservationReady(context, database, reservationId);
    expect(result.pickupCode).toBeUndefined();
  });
});

describe("collectReservationSchema", () => {
  it("requires a non-empty pickup code", () => {
    expect(collectReservationSchema.safeParse({ pickupCode: "" }).success).toBe(false);
    expect(collectReservationSchema.safeParse({ pickupCode: "7K9XPQ2M" }).success).toBe(true);
  });
});

describe("collectReservation", () => {
  it("hashes the candidate code before sending it to the RPC -- never the plaintext", async () => {
    const { database, rpcCalls } = fakeRpcOnlyDatabase({
      data: { id: reservationId, status: "collected" }, error: null,
    });
    await collectReservation(context, database, reservationId, { pickupCode: "7k9xpq2m" });
    const sentHash = rpcCalls[0]?.args.target_pickup_code_hash as string;
    expect(sentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sentHash).not.toContain("7k9xpq2m");
  });

  it("normalizes case before hashing, so the pharmacy's typed case doesn't affect verification", async () => {
    const { database: lower, rpcCalls: lowerCalls } = fakeRpcOnlyDatabase({ data: {}, error: null });
    const { database: upper, rpcCalls: upperCalls } = fakeRpcOnlyDatabase({ data: {}, error: null });
    await collectReservation(context, lower, reservationId, { pickupCode: "7k9xpq2m" });
    await collectReservation(context, upper, reservationId, { pickupCode: "7K9XPQ2M" });
    expect(lowerCalls[0]?.args.target_pickup_code_hash).toBe(upperCalls[0]?.args.target_pickup_code_hash);
  });
});
