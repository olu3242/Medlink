// Wave 3, Batch 3.1: Conversation Engine domain model.
//
// Per docs/release-scope.md's Conversation-Driven Architecture section, the
// Conversation Engine owns session management and channel identity binding,
// conversation state and multi-turn workflow coordination, intent
// detection and context preservation, human handoff and resumable
// conversations, delivery receipts and notification coordination, and an
// append-only interaction/decision audit trail. It owns no clinical,
// inventory, pricing, reservation, or payment rules -- those stay in the
// domain engines a Workflow Orchestrator invokes through the versioned API
// layer, unchanged by this package.

export const conversationChannels = ["whatsapp"] as const;
export type ConversationChannel = (typeof conversationChannels)[number];

export const conversationStatuses = [
  "active",
  "awaiting_handoff",
  "handed_off",
  "closed",
] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];

export const messageDirections = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof messageDirections)[number];

export const messageContentTypes = [
  "text",
  "image",
  "document",
  "template",
] as const;
export type MessageContentType = (typeof messageContentTypes)[number];

export const conversationEventKinds = [
  "message_received",
  "message_sent",
  "intent_detected",
  "workflow_invoked",
  "handoff_requested",
  "handoff_resolved",
  "identity_linked",
] as const;
export type ConversationEventKind = (typeof conversationEventKinds)[number];

export interface Conversation {
  readonly id: string;
  readonly organizationId: string;
  readonly patientId: string | null;
  readonly channel: ConversationChannel;
  readonly channelIdentity: string;
  readonly status: ConversationStatus;
  readonly currentIntent: string | null;
  readonly activeWorkflowType: string | null;
  readonly activeWorkflowInstanceId: string | null;
  readonly context: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lastInteractionAt: Date;
}

export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly direction: MessageDirection;
  readonly externalMessageId: string | null;
  readonly contentType: MessageContentType;
  readonly body: string | null;
  readonly mediaUrl: string | null;
  readonly createdAt: Date;
}

export interface ConversationEvent {
  readonly id: string;
  readonly conversationId: string;
  readonly kind: ConversationEventKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}
