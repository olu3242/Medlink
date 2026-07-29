import type {
  Conversation,
  ConversationChannel,
  ConversationEvent,
  ConversationEventKind,
  ConversationMessage,
  MessageContentType,
} from "./models";
import type { CreateConversation, RecordInboundMessage } from "./validation";

export interface ConversationStateChange {
  readonly patientId?: string;
  readonly status?: Conversation["status"];
  readonly currentIntent?: string | null;
  readonly activeWorkflowType?: string | null;
  readonly activeWorkflowInstanceId?: string | null;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface ConversationRepository {
  findByChannelIdentity(
    organizationId: string,
    channel: ConversationChannel,
    channelIdentity: string,
  ): Promise<Conversation | null>;
  findById(id: string): Promise<Conversation | null>;
  create(input: CreateConversation): Promise<Conversation>;
  updateState(id: string, changes: ConversationStateChange): Promise<Conversation>;
}

export interface RecordOutboundMessage {
  readonly contentType: MessageContentType;
  readonly body: string | null;
  readonly mediaUrl: string | null;
}

export interface MessageStore {
  recordInbound(
    conversationId: string,
    message: RecordInboundMessage,
  ): Promise<ConversationMessage>;
  recordOutbound(
    conversationId: string,
    message: RecordOutboundMessage,
  ): Promise<ConversationMessage>;
}

export interface ConversationEventLog {
  append(
    conversationId: string,
    kind: ConversationEventKind,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ConversationEvent>;
}

export interface DetectedIntent {
  readonly intent: string;
  readonly confidence: number;
}

// The Conversation Engine owns intent detection as a responsibility, not a
// specific algorithm -- packages/conversation ships a default keyword-rule
// classifier (see intent.ts) as the RC1 baseline; a future ML-backed
// implementation would satisfy this same port without changing the engine.
export interface IntentClassifier {
  classify(input: {
    readonly body: string | null;
    readonly contentType: MessageContentType;
  }): Promise<DetectedIntent>;
}

export interface WorkflowInvocationResult {
  readonly workflowInstanceId: string;
  readonly status: "running" | "completed" | "failed";
}

// The Conversation Engine never runs business rules itself; it delegates
// durable business processes to the Workflow Orchestrator (Batch 3.2)
// through this port rather than a direct package dependency, the same
// hexagonal-boundary discipline packages/medicine's MedicineCatalogReader
// and packages/clinical's ClinicalRule ports already establish.
export interface WorkflowInvoker {
  invoke(input: {
    readonly organizationId: string;
    readonly conversationId: string;
    readonly workflowType: string;
    readonly idempotencyKey: string;
    readonly context: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInvocationResult>;
}
