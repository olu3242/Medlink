import { describe, expect, it } from "vitest";
import { toConversation, toConversationEvent, toConversationMessage } from "./conversation-store";

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
