import { z } from "zod";
import {
  conversationChannels,
  conversationEventKinds,
  conversationStatuses,
  messageContentTypes,
  messageDirections,
  type Conversation,
  type ConversationEvent,
  type ConversationMessage,
} from "./models";

const idSchema = z.string().uuid();
const timestamps = {
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};

export const conversationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  patientId: idSchema.nullable(),
  channel: z.enum(conversationChannels),
  channelIdentity: z.string().trim().min(1).max(64),
  status: z.enum(conversationStatuses),
  currentIntent: z.string().trim().min(1).max(100).nullable(),
  activeWorkflowType: z.string().trim().min(1).max(100).nullable(),
  activeWorkflowInstanceId: idSchema.nullable(),
  context: z.record(z.string(), z.unknown()),
  ...timestamps,
  lastInteractionAt: z.coerce.date(),
}).strict();

export const conversationMessageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  direction: z.enum(messageDirections),
  externalMessageId: z.string().trim().min(1).max(200).nullable(),
  contentType: z.enum(messageContentTypes),
  body: z.string().trim().min(1).max(4096).nullable(),
  mediaUrl: z.string().trim().url().nullable(),
  createdAt: z.coerce.date(),
}).strict();

export const conversationEventSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  kind: z.enum(conversationEventKinds),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
}).strict();

export const createConversationSchema = z.object({
  organizationId: idSchema,
  channel: z.enum(conversationChannels),
  channelIdentity: z.string().trim().min(1).max(64),
}).strict();

export const recordInboundMessageSchema = z.object({
  externalMessageId: z.string().trim().min(1).max(200).nullable(),
  contentType: z.enum(messageContentTypes),
  body: z.string().trim().min(1).max(4096).nullable(),
  mediaUrl: z.string().trim().url().nullable(),
}).strict();

export type CreateConversation = z.infer<typeof createConversationSchema>;
export type RecordInboundMessage = z.infer<typeof recordInboundMessageSchema>;

export function parseConversation(value: unknown): Conversation {
  return conversationSchema.parse(value);
}

export function parseConversationMessage(value: unknown): ConversationMessage {
  return conversationMessageSchema.parse(value);
}

export function parseConversationEvent(value: unknown): ConversationEvent {
  return conversationEventSchema.parse(value);
}
