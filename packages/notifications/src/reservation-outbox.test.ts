import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboxEvent } from "@medlink/workflows";
import type { WhatsAppSender } from "@medlink/whatsapp";
import { describe, expect, it } from "vitest";
import { buildReservationNotificationDispatcher } from "./reservation-outbox";

// Never let a unit test make a live call to Meta's Graph API.
const fakeSender: WhatsAppSender = {
  send: async () => ({ externalMessageId: "external-message-1" }),
};

const reservationId = "00000000-0000-4000-8000-000000000010";
const patientId = "00000000-0000-4000-8000-000000000011";
const organizationId = "00000000-0000-4000-8000-000000000001";

function fakeDatabase(options: {
  readonly claimed: readonly OutboxEvent[];
  readonly reservationPatientId?: string | null;
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];

  const reservationsBuilder = {
    select: () => reservationsBuilder,
    eq: () => reservationsBuilder,
    maybeSingle: async () => ({
      data: options.reservationPatientId === null || options.reservationPatientId === undefined
        ? null
        : { patient_id: options.reservationPatientId },
      error: null,
    }),
  };
  const notificationsBuilder = {
    select: () => notificationsBuilder,
    eq: () => notificationsBuilder,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (payload: Record<string, unknown>) => {
      updates.push({ table: "notifications", payload });
      return {
        select: () => ({
          single: async () => ({ data: { id: "notification-1" }, error: null }),
        }),
      };
    },
  };
  const deliveryAttemptsBuilder = {
    insert: async (payload: Record<string, unknown>) => {
      updates.push({ table: "notification_delivery_attempts", payload });
      return { error: null };
    },
  };
  const conversationChannelBindingsBuilder = {
    select: () => conversationChannelBindingsBuilder,
    eq: () => conversationChannelBindingsBuilder,
    is: () => conversationChannelBindingsBuilder,
    maybeSingle: async () => ({ data: { channel_identifier: "phone-number-id" }, error: null }),
  };
  const conversationsBuilder = {
    select: () => conversationsBuilder,
    eq: () => conversationsBuilder,
    is: () => conversationsBuilder,
    order: () => conversationsBuilder,
    limit: () => conversationsBuilder,
    maybeSingle: async () => ({ data: { channel_identity: "+15550001111" }, error: null }),
  };

  const database = {
    rpc: async (fn: string) => {
      if (fn === "claim_runtime_outbox_events") {
        return {
          data: options.claimed.map((event) => ({
            id: event.id,
            organization_id: event.tenantId,
            event_type: event.type,
            aggregate_id: event.aggregateId || null,
            payload: event.payload,
            retry_count: event.attempts,
          })),
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      if (table === "reservations") return reservationsBuilder;
      if (table === "notifications") return notificationsBuilder;
      if (table === "notification_delivery_attempts") return deliveryAttemptsBuilder;
      if (table === "conversation_channel_bindings") return conversationChannelBindingsBuilder;
      if (table === "conversations") return conversationsBuilder;
      if (table === "runtime_outbox_events") {
        return {
          update: (payload: Record<string, unknown>) => {
            updates.push({ table: "runtime_outbox_events", payload });
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { database: database as unknown as SupabaseClient, updates };
}

function reservationLifecycleEvent(type: string, id = "event-1"): OutboxEvent {
  return {
    id,
    tenantId: organizationId,
    type,
    aggregateId: reservationId,
    payload: {},
    attempts: 0,
  };
}

describe("buildReservationNotificationDispatcher", () => {
  it("resolves the recipient from the reservation row for each lifecycle event type", async () => {
    for (const [type] of [
      ["reservation.confirmed.v1"],
      ["reservation.cancelled.v1"],
      ["reservation.ready.v1"],
      ["reservation.collected.v1"],
      ["payment.required.v1"],
      ["payment.failed.v1"],
      ["payment.succeeded.v1"],
    ] as const) {
      const { database, updates } = fakeDatabase({
        claimed: [reservationLifecycleEvent(type)],
        reservationPatientId: patientId,
      });
      const dispatcher = buildReservationNotificationDispatcher(database, "whatsapp-token", fakeSender);
      await dispatcher.dispatch("test-worker", 5);

      const notificationInsert = updates.find((u) => u.table === "notifications");
      expect(notificationInsert?.payload).toMatchObject({ recipient_id: patientId });
      const published = updates.find((u) => u.table === "runtime_outbox_events");
      expect(published?.payload).toMatchObject({ status: "published" });
    }
  });

  it("the ready notification never carries the pickup credential -- always empty variables, template text has no code placeholder", async () => {
    const { database, updates } = fakeDatabase({
      claimed: [reservationLifecycleEvent("reservation.ready.v1")],
      reservationPatientId: patientId,
    });
    const dispatcher = buildReservationNotificationDispatcher(database, "whatsapp-token", fakeSender);
    await dispatcher.dispatch("test-worker", 5);

    const notificationInsert = updates.find((u) => u.table === "notifications");
    expect(notificationInsert?.payload.template_variables).toEqual({});
    expect(notificationInsert?.payload.template_key).toBe("reservation_ready");
  });

  it("fails closed -- an event whose reservation no longer resolves a patient is skipped, not sent, and still marked published (no infinite retry)", async () => {
    const { database, updates } = fakeDatabase({
      claimed: [reservationLifecycleEvent("reservation.confirmed.v1")],
      reservationPatientId: null,
    });
    const dispatcher = buildReservationNotificationDispatcher(database, "whatsapp-token", fakeSender);
    await dispatcher.dispatch("test-worker", 5);

    expect(updates.find((u) => u.table === "notifications")).toBeUndefined();
    const published = updates.find((u) => u.table === "runtime_outbox_events");
    expect(published?.payload).toMatchObject({ status: "published" });
  });

  it("ignores reservation.credential_issued.v1 -- pickup credential issuance never dispatches a WhatsApp message", async () => {
    const { database, updates } = fakeDatabase({
      claimed: [reservationLifecycleEvent("reservation.credential_issued.v1")],
      reservationPatientId: patientId,
    });
    const dispatcher = buildReservationNotificationDispatcher(database, "whatsapp-token", fakeSender);
    await dispatcher.dispatch("test-worker", 5);

    // No consumer is registered for this event type at all -- unlike the
    // generic runtime.operation.completed events below (which
    // ReservationCreatedNotificationConsumer always claims and filters
    // internally), this one is dead-lettered by the dispatcher itself
    // before any consumer runs, so no notification is ever attempted.
    expect(updates.find((u) => u.table === "notifications")).toBeUndefined();
    const deadLettered = updates.find((u) => u.table === "runtime_outbox_events");
    expect(deadLettered?.payload).toMatchObject({ status: "dead_letter", last_error_code: "consumer_missing" });
  });

  it("ignores every generic runtime.operation.completed event except reservations.create", async () => {
    const event: OutboxEvent = {
      id: "event-2",
      tenantId: organizationId,
      type: "runtime.operation.completed",
      aggregateId: "",
      payload: { operation: "mar.create", requestId: "req-1", actorId: patientId },
      attempts: 0,
    };
    const { database, updates } = fakeDatabase({ claimed: [event] });
    const dispatcher = buildReservationNotificationDispatcher(database, "whatsapp-token", fakeSender);
    await dispatcher.dispatch("test-worker", 5);

    expect(updates.find((u) => u.table === "notifications")).toBeUndefined();
    const published = updates.find((u) => u.table === "runtime_outbox_events");
    expect(published?.payload).toMatchObject({ status: "published" });
  });

  it("reservations.create still notifies the acting patient directly, without a reservation lookup", async () => {
    const event: OutboxEvent = {
      id: "event-3",
      tenantId: organizationId,
      type: "runtime.operation.completed",
      aggregateId: "",
      payload: { operation: "reservations.create", requestId: "req-1", actorId: patientId },
      attempts: 0,
    };
    const { database, updates } = fakeDatabase({ claimed: [event] });
    const dispatcher = buildReservationNotificationDispatcher(database, "whatsapp-token", fakeSender);
    await dispatcher.dispatch("test-worker", 5);

    const notificationInsert = updates.find((u) => u.table === "notifications");
    expect(notificationInsert?.payload).toMatchObject({
      recipient_id: patientId,
      template_key: "reservation_confirmed",
    });
  });
});
