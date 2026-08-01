import type {
  Conversation,
  ConversationChannel,
  ConversationMessage,
  MessageContentType,
} from "./models";
import type {
  ConversationEventLog,
  ConversationRepository,
  IntentClassifier,
  MessageStore,
  WorkflowInvoker,
} from "./ports";
import type { RecordInboundMessage } from "./validation";

export interface InboundMessageInput {
  readonly organizationId: string;
  readonly channel: ConversationChannel;
  readonly channelIdentity: string;
  readonly externalMessageId: string | null;
  readonly contentType: MessageContentType;
  readonly body: string | null;
  readonly mediaUrl: string | null;
}

export type ConversationTurnAction =
  | "await_human"
  | "handoff_requested"
  | "workflow_invoked";

export interface ConversationTurnResult {
  readonly conversation: Conversation;
  readonly message: ConversationMessage;
  readonly action: ConversationTurnAction;
  readonly workflowInstanceId?: string;
}

// Below this confidence, the engine hands the conversation to a human
// rather than guessing which workflow to invoke -- see intent.ts. This is
// a routing safeguard, not a clinical decision threshold; it never
// suppresses, approves, or substitutes anything a domain engine would do.
const MINIMUM_INTENT_CONFIDENCE = 0.5;

// The Conversation Engine (Wave 3, Batch 3.1). Owns dialogue: session
// resolution, channel identity binding, intent detection, human handoff,
// and the append-only interaction/decision log. It never runs business
// rules itself -- every durable business process is delegated to the
// Workflow Orchestrator (Batch 3.2) through the WorkflowInvoker port, which
// in turn calls the same versioned API layer professional portals use (see
// docs/release-scope.md's Conversation-Driven Architecture diagram).
export class ConversationEngine {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageStore,
    private readonly events: ConversationEventLog,
    private readonly intents: IntentClassifier,
    private readonly workflows: WorkflowInvoker,
  ) {}

  async receiveMessage(input: InboundMessageInput): Promise<ConversationTurnResult> {
    let conversation = await this.conversations.findByChannelIdentity(
      input.organizationId,
      input.channel,
      input.channelIdentity,
    );
    if (!conversation) {
      conversation = await this.conversations.create({
        organizationId: input.organizationId,
        channel: input.channel,
        channelIdentity: input.channelIdentity,
      });
    } else if (conversation.status === "closed") {
      // Conversations are resumable: the same channel identity messaging
      // again after a prior journey closed reopens it rather than starting
      // a disconnected new one, preserving context and audit continuity.
      conversation = await this.conversations.updateState(conversation.id, {
        status: "active",
      });
    }

    const recordedMessage: RecordInboundMessage = {
      externalMessageId: input.externalMessageId,
      contentType: input.contentType,
      body: input.body,
      mediaUrl: input.mediaUrl,
    };
    const message = await this.messages.recordInbound(conversation.id, recordedMessage);
    await this.events.append(conversation.id, "message_received", { messageId: message.id });

    if (conversation.status === "handed_off") {
      return { conversation, message, action: "await_human" };
    }

    const detected = await this.intents.classify({
      body: input.body,
      contentType: input.contentType,
    });
    await this.events.append(conversation.id, "intent_detected", {
      intent: detected.intent,
      confidence: detected.confidence,
    });

    if (detected.confidence < MINIMUM_INTENT_CONFIDENCE) {
      const handedOff = await this.requestHandoff(conversation.id, "low_confidence_intent");
      return { conversation: handedOff, message, action: "handoff_requested" };
    }

    // A recognized intent can still name a workflow type the orchestrator
    // has no executable steps for yet (packages/workflows/src/definitions.ts
    // documents all 15 canonical workflows structurally, but most don't have
    // executable steps behind them -- see apps/web/lib/workflow-invoker.ts's
    // WorkflowOrchestratorInvoker). Per the Conversation Runtime profile's
    // "support ... escalation, human handoff" obligation, that must hand the
    // conversation to a human the same way low intent confidence already
    // does, not throw and crash the entry point -- a crash here is a
    // provider-visible failure Meta will retry indefinitely, for a message
    // that was never actually unrecoverable, just unroutable today.
    let invoked;
    try {
      invoked = await this.workflows.invoke({
        organizationId: input.organizationId,
        conversationId: conversation.id,
        workflowType: detected.intent,
        idempotencyKey: message.externalMessageId ?? message.id,
        context: conversation.context,
      });
    } catch {
      const handedOff = await this.requestHandoff(conversation.id, "workflow_invocation_failed");
      return { conversation: handedOff, message, action: "handoff_requested" };
    }
    await this.events.append(conversation.id, "workflow_invoked", {
      workflowType: detected.intent,
      workflowInstanceId: invoked.workflowInstanceId,
    });

    const updated = await this.conversations.updateState(conversation.id, {
      currentIntent: detected.intent,
      activeWorkflowType: detected.intent,
      activeWorkflowInstanceId: invoked.workflowInstanceId,
    });

    return {
      conversation: updated,
      message,
      action: "workflow_invoked",
      workflowInstanceId: invoked.workflowInstanceId,
    };
  }

  async requestHandoff(conversationId: string, reason: string): Promise<Conversation> {
    const updated = await this.conversations.updateState(conversationId, {
      status: "handed_off",
    });
    await this.events.append(conversationId, "handoff_requested", { reason });
    return updated;
  }

  async resolveHandoff(conversationId: string): Promise<Conversation> {
    const updated = await this.conversations.updateState(conversationId, {
      status: "active",
    });
    await this.events.append(conversationId, "handoff_resolved", {});
    return updated;
  }

  async linkPatientIdentity(conversationId: string, patientId: string): Promise<Conversation> {
    const updated = await this.conversations.updateState(conversationId, { patientId });
    await this.events.append(conversationId, "identity_linked", { patientId });
    return updated;
  }

  async sendReply(
    conversationId: string,
    reply: { readonly contentType: MessageContentType; readonly body: string | null; readonly mediaUrl: string | null },
  ): Promise<ConversationMessage> {
    const message = await this.messages.recordOutbound(conversationId, reply);
    await this.events.append(conversationId, "message_sent", { messageId: message.id });
    return message;
  }
}
