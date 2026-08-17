import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "./models";
import type {
  ConversationRepository,
  MessageStore,
  ConversationEventLog,
  WorkflowInvoker,
} from "./ports";
import { ConversationEngine } from "./service";

function dependencies() {
  let conversation: Conversation | null = null;
  const conversations: ConversationRepository = {
    findByChannelIdentity: vi.fn(async () => conversation),
    findById: vi.fn(async () => conversation),
    create: vi.fn(async (input) => (conversation = {
      id: "conversation-1", ...input, patientId: null, status: "active",
      currentIntent: null, activeWorkflowType: null, activeWorkflowInstanceId: null,
      context: {}, createdAt: new Date(), updatedAt: new Date(), lastInteractionAt: new Date(),
    })),
    updateState: vi.fn(async (_id, changes) => (conversation = { ...conversation, ...changes })),
  };
  const messages: MessageStore = {
    recordInbound: vi.fn(async (conversationId, input) => ({
      id: "message-1", conversationId, direction: "inbound", ...input, createdAt: new Date(),
    })),
    recordOutbound: vi.fn(),
  };
  const events: ConversationEventLog = { append: vi.fn(async (conversationId, kind, payload) => ({
    id: crypto.randomUUID(), conversationId, kind, payload, createdAt: new Date(),
  })) };
  const workflows: WorkflowInvoker = {
    invoke: vi.fn(async () => ({ workflowInstanceId: "workflow-1", status: "running" as const })),
  };
  const engine = new ConversationEngine(conversations, messages, events, {
    classify: vi.fn(async () => ({ intent: "medicine_search", confidence: 1 })),
  }, workflows);
  return { engine, workflows, events };
}

const message = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  channel: "whatsapp" as const, channelIdentity: "+2348000000001",
  externalMessageId: "wamid.1", contentType: "text" as const,
  body: "find amoxicillin", mediaUrl: null, requireIdentity: true,
};

describe("channel identity routing", () => {
  it("hands an unknown phone off without invoking a workflow", async () => {
    const { engine, workflows } = dependencies();
    const result = await engine.receiveMessage({ ...message, patientId: null });
    expect(result.action).toBe("handoff_requested");
    expect(workflows.invoke).not.toHaveBeenCalled();
  });

  it("links a verified identity and carries it into workflow context", async () => {
    const { engine, workflows, events } = dependencies();
    const patientId = "00000000-0000-4000-8000-000000000099";
    const result = await engine.receiveMessage({ ...message, patientId });
    expect(result.action).toBe("workflow_invoked");
    expect(workflows.invoke).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ patientId, messageBody: "find amoxicillin" }),
    }));
    expect(events.append).toHaveBeenCalledWith(
      "conversation-1", "identity_linked", { patientId },
    );
  });
});
