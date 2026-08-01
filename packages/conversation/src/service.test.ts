import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  Conversation,
  ConversationChannel,
  ConversationEvent,
  ConversationEventKind,
  ConversationMessage,
} from "./models";
import type {
  ConversationEventLog,
  ConversationRepository,
  ConversationStateChange,
  DetectedIntent,
  IntentClassifier,
  MessageStore,
  RecordOutboundMessage,
  WorkflowInvocationResult,
  WorkflowInvoker,
} from "./ports";
import { KeywordIntentClassifier } from "./intent";
import { ConversationEngine } from "./service";
import type { CreateConversation, RecordInboundMessage } from "./validation";

const organizationId = "00000000-0000-4000-8000-000000000001";
const now = () => new Date("2026-07-29T00:00:00.000Z");

class InMemoryConversationRepository implements ConversationRepository {
  private readonly byId = new Map<string, Conversation>();

  async findByChannelIdentity(
    orgId: string,
    channel: ConversationChannel,
    channelIdentity: string,
  ): Promise<Conversation | null> {
    for (const conversation of this.byId.values()) {
      if (
        conversation.organizationId === orgId &&
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
      id: randomUUID(),
      organizationId: input.organizationId,
      patientId: null,
      channel: input.channel,
      channelIdentity: input.channelIdentity,
      status: "active",
      currentIntent: null,
      activeWorkflowType: null,
      activeWorkflowInstanceId: null,
      context: {},
      createdAt: now(),
      updatedAt: now(),
      lastInteractionAt: now(),
    };
    this.byId.set(conversation.id, conversation);
    return conversation;
  }

  async updateState(id: string, changes: ConversationStateChange): Promise<Conversation> {
    const existing = this.byId.get(id);
    if (!existing) throw new Error(`Conversation '${id}' was not found`);
    const updated: Conversation = {
      ...existing,
      ...(changes.patientId !== undefined ? { patientId: changes.patientId } : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.currentIntent !== undefined ? { currentIntent: changes.currentIntent } : {}),
      ...(changes.activeWorkflowType !== undefined
        ? { activeWorkflowType: changes.activeWorkflowType }
        : {}),
      ...(changes.activeWorkflowInstanceId !== undefined
        ? { activeWorkflowInstanceId: changes.activeWorkflowInstanceId }
        : {}),
      ...(changes.context !== undefined ? { context: changes.context } : {}),
      updatedAt: now(),
      lastInteractionAt: now(),
    };
    this.byId.set(id, updated);
    return updated;
  }
}

class InMemoryMessageStore implements MessageStore {
  readonly messages: ConversationMessage[] = [];

  async recordInbound(
    conversationId: string,
    message: RecordInboundMessage,
  ): Promise<ConversationMessage> {
    const recorded: ConversationMessage = {
      id: randomUUID(),
      conversationId,
      direction: "inbound",
      externalMessageId: message.externalMessageId,
      contentType: message.contentType,
      body: message.body,
      mediaUrl: message.mediaUrl,
      createdAt: now(),
    };
    this.messages.push(recorded);
    return recorded;
  }

  async recordOutbound(
    conversationId: string,
    message: RecordOutboundMessage,
  ): Promise<ConversationMessage> {
    const recorded: ConversationMessage = {
      id: randomUUID(),
      conversationId,
      direction: "outbound",
      externalMessageId: null,
      contentType: message.contentType,
      body: message.body,
      mediaUrl: message.mediaUrl,
      createdAt: now(),
    };
    this.messages.push(recorded);
    return recorded;
  }
}

class InMemoryEventLog implements ConversationEventLog {
  readonly events: ConversationEvent[] = [];

  async append(
    conversationId: string,
    kind: ConversationEventKind,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ConversationEvent> {
    const event: ConversationEvent = {
      id: randomUUID(),
      conversationId,
      kind,
      payload,
      createdAt: now(),
    };
    this.events.push(event);
    return event;
  }
}

class FixedIntentClassifier implements IntentClassifier {
  constructor(private readonly result: DetectedIntent) {}
  async classify(): Promise<DetectedIntent> {
    return this.result;
  }
}

class RecordingWorkflowInvoker implements WorkflowInvoker {
  readonly calls: Array<{
    readonly organizationId: string;
    readonly conversationId: string;
    readonly workflowType: string;
    readonly idempotencyKey: string;
  }> = [];

  async invoke(input: {
    readonly organizationId: string;
    readonly conversationId: string;
    readonly workflowType: string;
    readonly idempotencyKey: string;
  }): Promise<WorkflowInvocationResult> {
    this.calls.push(input);
    return { workflowInstanceId: `workflow-${this.calls.length}`, status: "running" };
  }
}

function engine(intents: IntentClassifier) {
  const conversations = new InMemoryConversationRepository();
  const messages = new InMemoryMessageStore();
  const events = new InMemoryEventLog();
  const workflows = new RecordingWorkflowInvoker();
  return {
    conversations,
    messages,
    events,
    workflows,
    engine: new ConversationEngine(conversations, messages, events, intents, workflows),
  };
}

const baseMessage = {
  organizationId,
  channel: "whatsapp" as const,
  channelIdentity: "+2348000000001",
  externalMessageId: "wamid.001",
  contentType: "text" as const,
  mediaUrl: null,
};

describe("ConversationEngine", () => {
  it("creates a new conversation on first contact and invokes a workflow for a recognized intent", async () => {
    const { engine: conversationEngine, conversations, workflows } = engine(
      new FixedIntentClassifier({ intent: "medicine_search", confidence: 1 }),
    );

    const result = await conversationEngine.receiveMessage({
      ...baseMessage,
      body: "I need medicine for a headache",
    });

    expect(result.action).toBe("workflow_invoked");
    expect(result.workflowInstanceId).toBe("workflow-1");
    expect(workflows.calls).toHaveLength(1);
    expect(workflows.calls[0]).toMatchObject({ workflowType: "medicine_search" });
    expect(result.conversation.activeWorkflowType).toBe("medicine_search");
    expect(await conversations.findById(result.conversation.id)).not.toBeNull();
  });

  it("reuses the same conversation for the same channel identity across messages", async () => {
    const { engine: conversationEngine, conversations } = engine(
      new FixedIntentClassifier({ intent: "greeting", confidence: 1 }),
    );

    const first = await conversationEngine.receiveMessage({ ...baseMessage, body: "hello" });
    const second = await conversationEngine.receiveMessage({
      ...baseMessage,
      externalMessageId: "wamid.002",
      body: "hi again",
    });

    expect(second.conversation.id).toBe(first.conversation.id);
    const all = await conversations.findByChannelIdentity(
      organizationId,
      "whatsapp",
      baseMessage.channelIdentity,
    );
    expect(all?.id).toBe(first.conversation.id);
  });

  it("hands off to a human rather than guessing when intent confidence is below threshold", async () => {
    const { engine: conversationEngine, workflows, events } = engine(
      new FixedIntentClassifier({ intent: "unknown", confidence: 0 }),
    );

    const result = await conversationEngine.receiveMessage({
      ...baseMessage,
      body: "asdkjaslkdj",
    });

    expect(result.action).toBe("handoff_requested");
    expect(result.conversation.status).toBe("handed_off");
    expect(workflows.calls).toHaveLength(0);
    expect(events.events.map((event) => event.kind)).toContain("handoff_requested");
  });

  it("hands off to a human rather than crashing when the classified intent names a workflow with no executable steps yet", async () => {
    class FailingWorkflowInvoker implements WorkflowInvoker {
      async invoke(): Promise<WorkflowInvocationResult> {
        throw new Error("No canonical workflow definition is wired for workflow type 'prescription_upload'");
      }
    }
    const conversations = new InMemoryConversationRepository();
    const messages = new InMemoryMessageStore();
    const events = new InMemoryEventLog();
    const conversationEngine = new ConversationEngine(
      conversations,
      messages,
      events,
      new FixedIntentClassifier({ intent: "prescription_upload", confidence: 1 }),
      new FailingWorkflowInvoker(),
    );

    const result = await conversationEngine.receiveMessage({
      ...baseMessage,
      contentType: "image",
      body: null,
      mediaUrl: "media-id-1",
    });

    expect(result.action).toBe("handoff_requested");
    expect(result.conversation.status).toBe("handed_off");
    expect(events.events.map((event) => event.kind)).toContain("handoff_requested");
    // The message itself was still durably recorded before the failed
    // invocation -- a patient's prescription photo is never lost just
    // because the orchestrator can't route it yet.
    expect(result.message.mediaUrl).toBe("media-id-1");
  });

  it("does not re-run intent detection or invoke a workflow once handed off", async () => {
    const { engine: conversationEngine, workflows } = engine(
      new FixedIntentClassifier({ intent: "unknown", confidence: 0 }),
    );

    await conversationEngine.receiveMessage({ ...baseMessage, body: "asdkjaslkdj" });
    const followUp = await conversationEngine.receiveMessage({
      ...baseMessage,
      externalMessageId: "wamid.002",
      body: "still confused",
    });

    expect(followUp.action).toBe("await_human");
    expect(workflows.calls).toHaveLength(0);
  });

  it("reopens a closed conversation for the same channel identity rather than erroring", async () => {
    const { engine: conversationEngine, conversations } = engine(
      new FixedIntentClassifier({ intent: "greeting", confidence: 1 }),
    );

    const first = await conversationEngine.receiveMessage({ ...baseMessage, body: "hello" });
    await conversations.updateState(first.conversation.id, { status: "closed" });

    const resumed = await conversationEngine.receiveMessage({
      ...baseMessage,
      externalMessageId: "wamid.003",
      body: "hello again",
    });

    expect(resumed.conversation.id).toBe(first.conversation.id);
    expect(resumed.conversation.status).not.toBe("closed");
  });

  it("links a patient identity to a conversation and records the decision", async () => {
    const { engine: conversationEngine, events } = engine(
      new FixedIntentClassifier({ intent: "greeting", confidence: 1 }),
    );
    const { conversation } = await conversationEngine.receiveMessage({
      ...baseMessage,
      body: "hello",
    });
    const patientId = "00000000-0000-4000-8000-000000000099";

    const linked = await conversationEngine.linkPatientIdentity(conversation.id, patientId);

    expect(linked.patientId).toBe(patientId);
    expect(events.events.some((event) => event.kind === "identity_linked")).toBe(true);
  });

  it("records an outbound reply and its send event", async () => {
    const { engine: conversationEngine, messages, events } = engine(
      new FixedIntentClassifier({ intent: "greeting", confidence: 1 }),
    );
    const { conversation } = await conversationEngine.receiveMessage({
      ...baseMessage,
      body: "hello",
    });

    const reply = await conversationEngine.sendReply(conversation.id, {
      contentType: "text",
      body: "Hi! How can I help you today?",
      mediaUrl: null,
    });

    expect(reply.direction).toBe("outbound");
    expect(messages.messages).toContainEqual(reply);
    expect(events.events.some((event) => event.kind === "message_sent")).toBe(true);
  });
});

describe("KeywordIntentClassifier", () => {
  const classifier = new KeywordIntentClassifier();

  it("recognizes a prescription-upload intent from text", async () => {
    const result = await classifier.classify({ body: "here is my prescription", contentType: "text" });
    expect(result).toEqual({ intent: "prescription_upload", confidence: 1 });
  });

  it("treats non-text media as a prescription upload without needing text", async () => {
    const result = await classifier.classify({ body: null, contentType: "image" });
    expect(result).toEqual({ intent: "prescription_upload", confidence: 1 });
  });

  it("returns zero confidence for unrecognized free text rather than guessing", async () => {
    const result = await classifier.classify({ body: "xyzzy plugh", contentType: "text" });
    expect(result).toEqual({ intent: "unknown", confidence: 0 });
  });

  it("returns zero confidence for empty text", async () => {
    const result = await classifier.classify({ body: "   ", contentType: "text" });
    expect(result).toEqual({ intent: "unknown", confidence: 0 });
  });
});
