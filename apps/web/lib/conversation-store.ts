import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseConversation,
  parseConversationEvent,
  parseConversationMessage,
  type Conversation,
  type ConversationChannel,
  type ConversationEvent,
  type ConversationEventKind,
  type ConversationEventLog,
  type ConversationMessage,
  type ConversationRepository,
  type ConversationStateChange,
  type CreateConversation,
  type MessageStore,
  type RecordInboundMessage,
  type RecordOutboundMessage,
} from "@medlink/conversation";
import { RuntimeError } from "@medlink/runtime";

// Supabase-backed implementations of packages/conversation's ports, the
// same "adapter lives in the consuming app, not the domain package"
// pattern apps/admin/lib/medicine-repository.ts established for Wave 2.
// Unlike that file's toBrandMedicine (which safeParses and returns null
// for a row outside a vocabulary this package doesn't control), the
// conversations/conversation_messages/conversation_events schema (migration
// 202607290012) was written specifically to match packages/conversation's
// domain model -- there is no external vocabulary drift to tolerate here,
// so a row that fails to parse is a real bug, not an honest gap, and the
// mappers below throw rather than swallow it.

function infrastructureError(cause: unknown): RuntimeError {
  return new RuntimeError(
    "infrastructure",
    "database_operation_failed",
    "The data operation could not be completed",
    503,
    true,
    "Retry later.",
    { cause },
  );
}

interface ConversationRow {
  id: string;
  organization_id: string;
  patient_id: string | null;
  channel: string;
  channel_identity: string;
  status: string;
  current_intent: string | null;
  active_workflow_type: string | null;
  active_workflow_instance_id: string | null;
  context: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_interaction_at: string;
}

interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  external_message_id: string | null;
  content_type: string;
  body: string | null;
  media_url: string | null;
  created_at: string;
}

interface ConversationEventRow {
  id: string;
  conversation_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function toConversation(row: ConversationRow): Conversation {
  return parseConversation({
    id: row.id,
    organizationId: row.organization_id,
    patientId: row.patient_id,
    channel: row.channel,
    channelIdentity: row.channel_identity,
    status: row.status,
    currentIntent: row.current_intent,
    activeWorkflowType: row.active_workflow_type,
    activeWorkflowInstanceId: row.active_workflow_instance_id,
    context: row.context,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastInteractionAt: row.last_interaction_at,
  });
}

export function toConversationMessage(row: ConversationMessageRow): ConversationMessage {
  return parseConversationMessage({
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    externalMessageId: row.external_message_id,
    contentType: row.content_type,
    body: row.body,
    mediaUrl: row.media_url,
    createdAt: row.created_at,
  });
}

export function toConversationEvent(row: ConversationEventRow): ConversationEvent {
  return parseConversationEvent({
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at,
  });
}

function stateChangeColumns(changes: ConversationStateChange): Record<string, unknown> {
  return {
    ...(changes.patientId !== undefined ? { patient_id: changes.patientId } : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(changes.currentIntent !== undefined ? { current_intent: changes.currentIntent } : {}),
    ...(changes.activeWorkflowType !== undefined
      ? { active_workflow_type: changes.activeWorkflowType }
      : {}),
    ...(changes.activeWorkflowInstanceId !== undefined
      ? { active_workflow_instance_id: changes.activeWorkflowInstanceId }
      : {}),
    ...(changes.context !== undefined ? { context: changes.context } : {}),
    last_interaction_at: new Date().toISOString(),
  };
}

export class SupabaseConversationRepository implements ConversationRepository {
  constructor(private readonly database: SupabaseClient) {}

  async findByChannelIdentity(
    organizationId: string,
    channel: ConversationChannel,
    channelIdentity: string,
  ): Promise<Conversation | null> {
    const { data, error } = await this.database.from("conversations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("channel", channel)
      .eq("channel_identity", channelIdentity)
      .is("deleted_at", null)
      .maybeSingle<ConversationRow>();
    if (error) throw infrastructureError(error);
    return data ? toConversation(data) : null;
  }

  async findById(id: string): Promise<Conversation | null> {
    const { data, error } = await this.database.from("conversations")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle<ConversationRow>();
    if (error) throw infrastructureError(error);
    return data ? toConversation(data) : null;
  }

  async create(input: CreateConversation): Promise<Conversation> {
    const { data, error } = await this.database.from("conversations")
      .insert({
        organization_id: input.organizationId,
        channel: input.channel,
        channel_identity: input.channelIdentity,
      })
      .select("*")
      .single<ConversationRow>();
    if (error) throw infrastructureError(error);
    return toConversation(data);
  }

  async updateState(id: string, changes: ConversationStateChange): Promise<Conversation> {
    const { data, error } = await this.database.from("conversations")
      .update(stateChangeColumns(changes))
      .eq("id", id)
      .select("*")
      .single<ConversationRow>();
    if (error) throw infrastructureError(error);
    return toConversation(data);
  }
}

export class SupabaseMessageStore implements MessageStore {
  constructor(private readonly database: SupabaseClient) {}

  async recordInbound(
    conversationId: string,
    message: RecordInboundMessage,
  ): Promise<ConversationMessage> {
    const { data, error } = await this.database.from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        direction: "inbound",
        external_message_id: message.externalMessageId,
        content_type: message.contentType,
        body: message.body,
        media_url: message.mediaUrl,
      })
      .select("*")
      .single<ConversationMessageRow>();
    if (error) throw infrastructureError(error);
    return toConversationMessage(data);
  }

  async recordOutbound(
    conversationId: string,
    message: RecordOutboundMessage,
  ): Promise<ConversationMessage> {
    const { data, error } = await this.database.from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        direction: "outbound",
        external_message_id: null,
        content_type: message.contentType,
        body: message.body,
        media_url: message.mediaUrl,
      })
      .select("*")
      .single<ConversationMessageRow>();
    if (error) throw infrastructureError(error);
    return toConversationMessage(data);
  }
}

export class SupabaseConversationEventLog implements ConversationEventLog {
  constructor(private readonly database: SupabaseClient) {}

  async append(
    conversationId: string,
    kind: ConversationEventKind,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ConversationEvent> {
    const { data, error } = await this.database.from("conversation_events")
      .insert({ conversation_id: conversationId, kind, payload })
      .select("*")
      .single<ConversationEventRow>();
    if (error) throw infrastructureError(error);
    return toConversationEvent(data);
  }
}
