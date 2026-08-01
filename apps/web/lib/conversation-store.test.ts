import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  isUniqueViolation,
  SupabaseMessageStore,
  toConversation,
  toConversationEvent,
  toConversationMessage,
} from "./conversation-store";

const now = "2026-07-29T00:00:00.000Z";

describe("toConversation", () => {
  const baseRow = {
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    patient_id: null,
    channel: "whatsapp",
    channel_identity: "+2348000000001",
    status: "active",
    current_intent: null,
    active_workflow_type: null,
    active_workflow_instance_id: null,
    context: {},
    created_at: now,
    updated_at: now,
    last_interaction_at: now,
  };

  it("maps a valid row to the packages/conversation Conversation shape", () => {
    const conversation = toConversation(baseRow);
    expect(conversation).toMatchObject({
      id: baseRow.id,
      organizationId: baseRow.organization_id,
      channel: "whatsapp",
      channelIdentity: "+2348000000001",
      status: "active",
      patientId: null,
    });
  });

  it("throws rather than silently coercing a row with a status outside the schema this migration defines", () => {
    expect(() => toConversation({ ...baseRow, status: "not-a-real-status" })).toThrow();
  });
});

describe("toConversationMessage", () => {
  it("maps a valid inbound message row", () => {
    const message = toConversationMessage({
      id: "00000000-0000-4000-8000-000000000003",
      conversation_id: "00000000-0000-4000-8000-000000000001",
      direction: "inbound",
      external_message_id: "wamid.001",
      content_type: "text",
      body: "hello",
      media_url: null,
      created_at: now,
    });
    expect(message).toMatchObject({ direction: "inbound", body: "hello", mediaUrl: null });
  });

  it("throws rather than silently coercing a row with an out-of-schema content type", () => {
    expect(() =>
      toConversationMessage({
        id: "00000000-0000-4000-8000-000000000003",
        conversation_id: "00000000-0000-4000-8000-000000000001",
        direction: "inbound",
        external_message_id: "wamid.001",
        content_type: "audio",
        body: null,
        media_url: null,
        created_at: now,
      }),
    ).toThrow();
  });
});

describe("toConversationEvent", () => {
  it("maps a valid event row", () => {
    const event = toConversationEvent({
      id: "00000000-0000-4000-8000-000000000004",
      conversation_id: "00000000-0000-4000-8000-000000000001",
      kind: "intent_detected",
      payload: { intent: "medicine_search", confidence: 1 },
      created_at: now,
    });
    expect(event).toMatchObject({ kind: "intent_detected", payload: { intent: "medicine_search" } });
  });
});

describe("isUniqueViolation", () => {
  it("recognizes Postgres' unique_violation SQLSTATE", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("rejects any other error shape", () => {
    expect(isUniqueViolation({ code: "23514" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

// A minimal, hand-rolled fake of the specific .from().insert().select()...
// .single() / .from().select().eq().eq().single() chains
// SupabaseMessageStore.recordInbound actually calls, scripted by call
// order (resolveOrganizationId's lookup is always call #1). There is no
// existing SupabaseClient mock anywhere in this repo to reuse -- every
// other adapter class is exercised only by the live-DB suite -- but this
// specific idempotent-replay branch is real new control flow worth
// covering directly rather than only at the live-DB level.
function scriptedSupabaseClient(
  steps: ReadonlyArray<{ data: unknown; error: unknown }>,
): SupabaseClient {
  let call = 0;
  const client = {
    from: () => {
      const step = steps[call++];
      const builder = {
        insert: () => builder,
        select: () => builder,
        eq: () => builder,
        single: async () => step,
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

describe("SupabaseMessageStore.recordInbound", () => {
  const conversationId = "00000000-0000-4000-8000-000000000001";
  const organizationId = "00000000-0000-4000-8000-000000000002";
  const inboundMessage = {
    externalMessageId: "wamid.001",
    contentType: "text" as const,
    body: "hello",
    mediaUrl: null,
  };
  const insertedRow = {
    id: "00000000-0000-4000-8000-000000000003",
    conversation_id: conversationId,
    direction: "inbound",
    external_message_id: "wamid.001",
    content_type: "text",
    body: "hello",
    media_url: null,
    created_at: now,
  };

  it("returns the newly inserted message on the first delivery", async () => {
    const store = new SupabaseMessageStore(scriptedSupabaseClient([
      { data: { organization_id: organizationId }, error: null },
      { data: insertedRow, error: null },
    ]));

    const message = await store.recordInbound(conversationId, inboundMessage);

    expect(message).toMatchObject({ id: insertedRow.id, body: "hello" });
  });

  it("replays the existing row instead of throwing on a retried (duplicate) delivery", async () => {
    const store = new SupabaseMessageStore(scriptedSupabaseClient([
      { data: { organization_id: organizationId }, error: null },
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: insertedRow, error: null },
    ]));

    const message = await store.recordInbound(conversationId, inboundMessage);

    expect(message).toMatchObject({ id: insertedRow.id, body: "hello" });
  });

  it("still throws for an insert failure that is not a duplicate", async () => {
    const store = new SupabaseMessageStore(scriptedSupabaseClient([
      { data: { organization_id: organizationId }, error: null },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ]));

    await expect(store.recordInbound(conversationId, inboundMessage)).rejects.toThrow();
  });
});
