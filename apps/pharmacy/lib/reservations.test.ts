import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { decideReservation, reservationDecisionSchema } from "./reservations";

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
