import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboxEvent } from "@medlink/workflows";
import type { Notification } from "@medlink/notifications";
import type { NotificationService } from "@medlink/notifications";
import type { WhatsAppSender } from "@medlink/whatsapp";
import { describe, expect, it, vi } from "vitest";
import {
  ReservationConfirmedNotificationConsumer,
  SupabaseNotificationStore,
  SupabaseOutboxStore,
  toSupabaseWhatsAppRecipientResolver,
  WhatsAppNotificationChannel,
} from "./notification-outbox";

const baseEvent: OutboxEvent = {
  id: "event-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  type: "runtime.operation.completed",
  aggregateId: "",
  payload: { operation: "reservations.create", requestId: "req-1", actorId: "patient-1" },
  attempts: 0,
};

describe("SupabaseOutboxStore.claim", () => {
  it("maps claimed rows to OutboxEvent, defaulting a null aggregate_id to an empty string", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "event-1",
          organization_id: "org-1",
          event_type: "runtime.operation.completed",
          aggregate_id: null,
          payload: { operation: "reservations.create" },
          retry_count: 0,
        },
      ],
      error: null,
    });
    const database = { rpc } as unknown as SupabaseClient;
    const store = new SupabaseOutboxStore(database);

    const events = await store.claim("worker-1", 5);

    expect(rpc).toHaveBeenCalledWith("claim_runtime_outbox_events", {
      target_worker: "worker-1",
      target_limit: 5,
    });
    expect(events).toEqual([
      {
        id: "event-1",
        tenantId: "org-1",
        type: "runtime.operation.completed",
        aggregateId: "",
        payload: { operation: "reservations.create" },
        attempts: 0,
      },
    ]);
  });

  it("throws an infrastructure error when the RPC fails", async () => {
    const database = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "db down" } }),
    } as unknown as SupabaseClient;
    const store = new SupabaseOutboxStore(database);
    await expect(store.claim("worker-1", 5)).rejects.toMatchObject({ category: "infrastructure" });
  });
});

describe("SupabaseOutboxStore.published/retry/deadLetter", () => {
  it("published() marks the row published with a timestamp", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const database = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const store = new SupabaseOutboxStore(database);

    await store.published("event-1");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(eq).toHaveBeenCalledWith("id", "event-1");
  });

  it("retry() reads the current retry_count and increments it in the same update", async () => {
    const single = vi.fn().mockResolvedValue({ data: { retry_count: 2 }, error: null });
    const selectEq = vi.fn().mockReturnValue({ single });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const select = vi.fn().mockReturnValue({ eq: selectEq });
    const database = { from: vi.fn().mockReturnValue({ select, update }) } as unknown as SupabaseClient;
    const store = new SupabaseOutboxStore(database);

    await store.retry("event-1", new Date("2026-01-01T00:00:10Z"), "consumer_failed");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: "retrying",
      retry_count: 3,
      last_error_code: "consumer_failed",
    }));
  });

  it("deadLetter() marks the row dead_letter with the error code", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const database = { from: vi.fn().mockReturnValue({ update }) } as unknown as SupabaseClient;
    const store = new SupabaseOutboxStore(database);

    await store.deadLetter("event-1", "retry_exhausted");

    expect(update).toHaveBeenCalledWith({ status: "dead_letter", last_error_code: "retry_exhausted" });
  });
});

const notification: Notification = {
  id: "n-1",
  tenantId: "org-1",
  recipientId: "patient-1",
  template: "reservation_confirmed",
  variables: {},
  channel: "whatsapp",
};

describe("WhatsAppNotificationChannel.send", () => {
  it("throws for an unrecognized template", async () => {
    const sender: WhatsAppSender = { send: vi.fn() };
    const channel = new WhatsAppNotificationChannel(sender, async () => null);
    await expect(
      channel.send({ ...notification, template: "unknown_template" }),
    ).rejects.toMatchObject({ code: "unknown_template" });
  });

  it("throws when the recipient has no bound WhatsApp identity", async () => {
    const sender: WhatsAppSender = { send: vi.fn() };
    const channel = new WhatsAppNotificationChannel(sender, async () => null);
    await expect(channel.send(notification)).rejects.toMatchObject({ code: "recipient_not_bound" });
  });

  it("sends a text message to the resolved recipient and returns the provider message id", async () => {
    const send = vi.fn().mockResolvedValue({ externalMessageId: "wamid.123" });
    const sender: WhatsAppSender = { send };
    const channel = new WhatsAppNotificationChannel(
      sender,
      async () => ({ phoneNumberId: "phone-number-id-1", to: "+15551234567" }),
    );

    const result = await channel.send(notification);

    expect(result).toEqual({ providerId: "wamid.123" });
    expect(send).toHaveBeenCalledWith("phone-number-id-1", expect.objectContaining({
      to: "+15551234567",
      contentType: "text",
      mediaId: null,
      templateName: null,
    }));
  });
});

describe("toSupabaseWhatsAppRecipientResolver", () => {
  function fakeDatabase(bindingResult: unknown, conversationResult: unknown) {
    const from = vi.fn((table: string) => {
      if (table === "conversation_channel_bindings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({ maybeSingle: async () => bindingResult }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  order: () => ({
                    limit: () => ({ maybeSingle: async () => conversationResult }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    });
    return { from } as unknown as SupabaseClient;
  }

  it("returns null when the tenant has no bound WhatsApp channel", async () => {
    const database = fakeDatabase({ data: null, error: null }, { data: null, error: null });
    const resolve = toSupabaseWhatsAppRecipientResolver(database);
    expect(await resolve("org-1", "patient-1")).toBeNull();
  });

  it("returns null when the patient has no WhatsApp conversation on record", async () => {
    const database = fakeDatabase(
      { data: { channel_identifier: "phone-number-id-1" }, error: null },
      { data: null, error: null },
    );
    const resolve = toSupabaseWhatsAppRecipientResolver(database);
    expect(await resolve("org-1", "patient-1")).toBeNull();
  });

  it("returns the tenant's phone number id and the patient's WhatsApp number when both exist", async () => {
    const database = fakeDatabase(
      { data: { channel_identifier: "phone-number-id-1" }, error: null },
      { data: { channel_identity: "+15551234567" }, error: null },
    );
    const resolve = toSupabaseWhatsAppRecipientResolver(database);
    expect(await resolve("org-1", "patient-1")).toEqual({
      phoneNumberId: "phone-number-id-1",
      to: "+15551234567",
    });
  });
});

describe("SupabaseNotificationStore", () => {
  it("find() scopes the lookup by the message's own tenantId, not a fixed one", async () => {
    const notificationEq = vi.fn().mockReturnValue({
      maybeSingle: async () => ({ data: { id: "notification-1" }, error: null }),
    });
    const attemptEq2 = vi.fn().mockResolvedValue({
      data: { provider_message_reference: "wamid.123" },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "notifications") {
        return { select: () => ({ eq: () => ({ eq: notificationEq }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: attemptEq2 }) }) }) };
    });
    const database = { from } as unknown as SupabaseClient;
    const store = new SupabaseNotificationStore(database);

    const result = await store.find("event-1", { ...notification, tenantId: "org-2" });

    expect(result).toEqual({ providerId: "wamid.123" });
  });

  it("find() returns null when no prior notification exists for the key", async () => {
    const from = vi.fn().mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    });
    const database = { from } as unknown as SupabaseClient;
    const store = new SupabaseNotificationStore(database);
    expect(await store.find("event-1", notification)).toBeNull();
  });

  it("record() inserts the notification row scoped to message.tenantId, then a delivery attempt row", async () => {
    const insertedRows: Array<{ table: string; row: unknown }> = [];
    const from = vi.fn((table: string) => ({
      insert: (row: unknown) => {
        insertedRows.push({ table, row });
        if (table === "notifications") {
          return { select: () => ({ single: async () => ({ data: { id: "notification-1" }, error: null }) }) };
        }
        return Promise.resolve({ error: null });
      },
    }));
    const database = { from } as unknown as SupabaseClient;
    const store = new SupabaseNotificationStore(database);

    await store.record("event-1", { ...notification, tenantId: "org-3" }, { providerId: "wamid.123" });

    expect(insertedRows[0]).toMatchObject({
      table: "notifications",
      row: expect.objectContaining({ organization_id: "org-3", idempotency_key: "event-1" }),
    });
    expect(insertedRows[1]).toMatchObject({
      table: "notification_delivery_attempts",
      row: expect.objectContaining({
        organization_id: "org-3",
        notification_id: "notification-1",
        provider_message_reference: "wamid.123",
      }),
    });
  });
});

describe("ReservationConfirmedNotificationConsumer.handle", () => {
  it("no-ops for an operation other than reservations.create", async () => {
    const send = vi.fn();
    const consumer = new ReservationConfirmedNotificationConsumer(
      { send } as unknown as NotificationService,
    );
    await consumer.handle({ ...baseEvent, payload: { operation: "mars.create", actorId: "patient-1" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("no-ops when the event carries no actor id", async () => {
    const send = vi.fn();
    const consumer = new ReservationConfirmedNotificationConsumer(
      { send } as unknown as NotificationService,
    );
    await consumer.handle({ ...baseEvent, payload: { operation: "reservations.create" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a reservation_confirmed WhatsApp notification to the reservation's own actor", async () => {
    const send = vi.fn().mockResolvedValue({ providerId: "wamid.123" });
    const consumer = new ReservationConfirmedNotificationConsumer(
      { send } as unknown as NotificationService,
    );

    await consumer.handle(baseEvent);

    expect(send).toHaveBeenCalledWith(
      {
        id: "event-1",
        tenantId: baseEvent.tenantId,
        recipientId: "patient-1",
        template: "reservation_confirmed",
        variables: {},
        channel: "whatsapp",
      },
      "event-1",
    );
  });
});
