import { describe, expect, it } from "vitest";
import { conversationSchema, createConversationSchema, recordInboundMessageSchema } from "./validation";

const conversationId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const now = "2026-07-29T00:00:00.000Z";

describe("conversationSchema", () => {
  it("accepts a valid conversation", () => {
    const result = conversationSchema.safeParse({
      id: conversationId,
      organizationId,
      patientId: null,
      channel: "whatsapp",
      channelIdentity: "+2348000000001",
      status: "active",
      currentIntent: null,
      activeWorkflowType: null,
      activeWorkflowInstanceId: null,
      context: {},
      createdAt: now,
      updatedAt: now,
      lastInteractionAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a channel outside the closed vocabulary", () => {
    const result = conversationSchema.safeParse({
      id: conversationId,
      organizationId,
      patientId: null,
      channel: "sms",
      channelIdentity: "+2348000000001",
      status: "active",
      currentIntent: null,
      activeWorkflowType: null,
      activeWorkflowInstanceId: null,
      context: {},
      createdAt: now,
      updatedAt: now,
      lastInteractionAt: now,
    });
    expect(result.success).toBe(false);
  });
});

describe("createConversationSchema", () => {
  it("rejects an empty channel identity", () => {
    const result = createConversationSchema.safeParse({
      organizationId,
      channel: "whatsapp",
      channelIdentity: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("recordInboundMessageSchema", () => {
  it("requires a valid URL for media messages, not an arbitrary string", () => {
    const result = recordInboundMessageSchema.safeParse({
      externalMessageId: "wamid.001",
      contentType: "image",
      body: null,
      mediaUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});
