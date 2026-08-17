import { createHmac } from "node:crypto";
import type {
  Conversation,
  ConversationChannel,
  ConversationEvent,
  ConversationEventKind,
  ConversationEventLog,
  ConversationMessage,
  ConversationRepository,
  ConversationStateChange,
  CreateConversation,
  MessageStore,
  RecordInboundMessage,
  RecordOutboundMessage,
  WorkflowInvocationResult,
  WorkflowInvoker,
} from "@medlink/conversation";
import { describe, expect, it } from "vitest";
import {
  buildWhatsAppWebhookHandlers,
  UnsupportedWorkflowTypeError,
  UnwiredWorkflowInvoker,
  verifyWebhookChallenge,
  type WhatsAppWebhookDependencies,
} from "./whatsapp-webhook";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-01T00:00:00.000Z");

function sign(rawBody: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex")}`;
}

function textMessagePayload(overrides?: {
  readonly id?: string;
  readonly body?: string;
  readonly timestamp?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "entry-1",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "phone-number-1" },
          messages: [{
            from: "+2348000000001",
            id: overrides?.id ?? "wamid.001",
            timestamp: overrides?.timestamp ?? "1700000000",
            type: "text",
            text: { body: overrides?.body ?? "hi" },
          }],
        },
      }],
    }],
  };
}

// Minimal in-memory fakes -- same "each file gets its own, not shared
// across test files" convention packages/conversation/src/service.test.ts
// and apps/web/lib/workflow-invoker.test.ts already established.
class InMemoryConversationRepository implements ConversationRepository {
  private byId = new Map<string, Conversation>();
  private nextId = 1;

  async findByChannelIdentity(
    organizationId: string,
    channel: ConversationChannel,
    channelIdentity: string,
  ): Promise<Conversation | null> {
    for (const conversation of this.byId.values()) {
      if (
        conversation.organizationId === organizationId &&
        conversation.channel === channel &&
        conversation.channelIdentity === channelIdentity
      ) {
        return conversation;
      }
    }
    return null;
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: CreateConversation): Promise<Conversation> {
    const conversation: Conversation = {
      id: `conversation-${this.nextId++}`,
      organizationId: input.organizationId,
      channel: input.channel,
      channelIdentity: input.channelIdentity,
      status: "active",
      currentIntent: null,
      activeWorkflowType: null,
      activeWorkflowInstanceId: null,
      patientId: null,
      context: {},
      createdAt: NOW,
      updatedAt: NOW,
      lastInteractionAt: NOW,
    };
    this.byId.set(conversation.id, conversation);
    return conversation;
  }

  async updateState(id: string, changes: ConversationStateChange): Promise<Conversation> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`No conversation '${id}'`);
    const updated = { ...existing, ...changes };
    this.byId.set(id, updated);
    return updated;
  }
}

class InMemoryMessageStore implements MessageStore {
  readonly inbound: ConversationMessage[] = [];
  private nextId = 1;

  async recordInbound(conversationId: string, message: RecordInboundMessage): Promise<ConversationMessage> {
    const recorded: ConversationMessage = {
      id: `message-${this.nextId++}`,
      conversationId,
      direction: "inbound",
      externalMessageId: message.externalMessageId,
      contentType: message.contentType,
      body: message.body,
      mediaUrl: message.mediaUrl,
      createdAt: NOW,
    };
    this.inbound.push(recorded);
    return recorded;
  }

  async recordOutbound(conversationId: string, message: RecordOutboundMessage): Promise<ConversationMessage> {
    return {
      id: `message-${this.nextId++}`,
      conversationId,
      direction: "outbound",
      externalMessageId: null,
      contentType: message.contentType,
      body: message.body,
      mediaUrl: message.mediaUrl,
      createdAt: NOW,
    };
  }
}

class InMemoryEventLog implements ConversationEventLog {
  readonly events: ConversationEvent[] = [];
  private nextId = 1;

  async append(
    conversationId: string,
    kind: ConversationEventKind,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ConversationEvent> {
    const event: ConversationEvent = {
      id: `event-${this.nextId++}`,
      conversationId,
      kind,
      payload,
      createdAt: NOW,
    };
    this.events.push(event);
    return event;
  }
}

class RecordingWorkflowInvoker implements WorkflowInvoker {
  readonly calls: unknown[] = [];
  async invoke(input: unknown): Promise<WorkflowInvocationResult> {
    this.calls.push(input);
    return { workflowInstanceId: "workflow-1", status: "running" };
  }
}

function baseDeps(overrides?: Partial<WhatsAppWebhookDependencies>): WhatsAppWebhookDependencies {
  return {
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    resolveOrganizationId: async (phoneNumberId) =>
      phoneNumberId === "phone-number-1" ? ORGANIZATION_ID : null,
    resolveIdentity: async () => "00000000-0000-4000-8000-000000000099",
    conversations: new InMemoryConversationRepository(),
    messages: new InMemoryMessageStore(),
    events: new InMemoryEventLog(),
    workflows: new RecordingWorkflowInvoker(),
    ...overrides,
  };
}

describe("verifyWebhookChallenge", () => {
  const url = (params: Record<string, string>) =>
    new URL(`https://example.test/webhook?${new URLSearchParams(params).toString()}`);

  it("returns the challenge when mode and token both match", () => {
    const result = verifyWebhookChallenge(
      url({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "abc123" }),
      VERIFY_TOKEN,
    );
    expect(result).toBe("abc123");
  });

  it("returns null for the wrong verify token", () => {
    const result = verifyWebhookChallenge(
      url({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "abc123" }),
      VERIFY_TOKEN,
    );
    expect(result).toBeNull();
  });

  it("returns null for a mode other than subscribe", () => {
    const result = verifyWebhookChallenge(
      url({ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "abc123" }),
      VERIFY_TOKEN,
    );
    expect(result).toBeNull();
  });
});

describe("buildWhatsAppWebhookHandlers GET", () => {
  it("echoes the challenge on a valid handshake", () => {
    const { GET } = buildWhatsAppWebhookHandlers(baseDeps());
    const response = GET(new Request(
      `https://example.test/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=xyz`,
    ));
    expect(response.status).toBe(200);
  });

  it("returns 403 for an invalid handshake", () => {
    const { GET } = buildWhatsAppWebhookHandlers(baseDeps());
    const response = GET(new Request(
      "https://example.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=xyz",
    ));
    expect(response.status).toBe(403);
  });
});

describe("buildWhatsAppWebhookHandlers POST", () => {
  it("processes a correctly signed text message end to end", async () => {
    const messages = new InMemoryMessageStore();
    const workflows = new RecordingWorkflowInvoker();
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps({ messages, workflows }));
    const rawBody = JSON.stringify(textMessagePayload());

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ processed: 1, unsupported: 0 });
    expect(messages.inbound).toHaveLength(1);
    expect(messages.inbound[0]).toMatchObject({ externalMessageId: "wamid.001", body: "hi" });
  });

  it("accepts a delayed provider retry without treating provider time as authentication", async () => {
    const workflows = new RecordingWorkflowInvoker();
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps({ workflows }));
    const rawBody = JSON.stringify(textMessagePayload({
      id: "wamid.delayed",
      body: "find amoxicillin",
      timestamp: "1",
    }));

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    expect(workflows.calls).toHaveLength(1);
  });

  it("processes an out-of-order provider batch by message timestamp", async () => {
    const workflows = new RecordingWorkflowInvoker();
    const payload = textMessagePayload({ id: "wamid.later", body: "find later" });
    payload.entry[0]!.changes[0]!.value.messages.unshift({
      from: "+2348000000001",
      id: "wamid.earlier",
      timestamp: "1600000000",
      type: "text",
      text: { body: "find earlier" },
    });
    payload.entry[0]!.changes[0]!.value.messages.reverse();
    const rawBody = JSON.stringify(payload);
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps({ workflows }));

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    expect(workflows.calls.map((call) =>
      (call as { context: { messageBody: string } }).context.messageBody)).toEqual([
      "find earlier",
      "find later",
    ]);
  });

  it("rejects a delivery with no signature at all", async () => {
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps());
    const rawBody = JSON.stringify(textMessagePayload());

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      body: rawBody,
    }));

    expect(response.status).toBe(401);
  });

  it("rejects a delivery with a signature computed over a different body", async () => {
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps());
    const rawBody = JSON.stringify(textMessagePayload());
    const tamperedSignature = sign(JSON.stringify(textMessagePayload({ body: "something else" })));

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": tamperedSignature },
      body: rawBody,
    }));

    expect(response.status).toBe(401);
  });

  it("rejects a delivery from a phone number with no organization binding", async () => {
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps({
      resolveOrganizationId: async () => null,
    }));
    const rawBody = JSON.stringify(textMessagePayload());

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(403);
  });

  it("rejects a body that is not valid JSON, even with a signature covering it", async () => {
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps());
    const rawBody = "not json";

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(400);
  });

  it("counts status notifications without invoking the conversation engine", async () => {
    const workflows = new RecordingWorkflowInvoker();
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps({ workflows }));
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "entry-1",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "phone-number-1" },
            statuses: [{ id: "wamid.status.1", status: "delivered" }],
          },
        }],
      }],
    };
    const rawBody = JSON.stringify(payload);

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ processed: 0, unsupported: 0 });
    expect(workflows.calls).toHaveLength(0);
  });

  it("hands off to a human rather than crashing when the classified intent has no wired workflow", async () => {
    const events = new InMemoryEventLog();
    const { POST } = buildWhatsAppWebhookHandlers(baseDeps({
      events,
      workflows: new UnwiredWorkflowInvoker(),
    }));
    const rawBody = JSON.stringify(textMessagePayload({ body: "hi" }));

    const response = await POST(new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": sign(rawBody) },
      body: rawBody,
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ processed: 1, handedOff: 1 });
    expect(events.events.map((event) => event.kind)).toContain("handoff_requested");
  });
});

describe("UnwiredWorkflowInvoker", () => {
  it("always throws UnsupportedWorkflowTypeError, for every workflow type", async () => {
    await expect(
      new UnwiredWorkflowInvoker().invoke({
        organizationId: ORGANIZATION_ID,
        conversationId: "conversation-1",
        workflowType: "medicine_search",
        idempotencyKey: "key-1",
        context: {},
      }),
    ).rejects.toThrow(UnsupportedWorkflowTypeError);
  });
});
