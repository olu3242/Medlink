import { z } from "zod";
import { MalformedWebhookPayloadError } from "./errors";

// Only the fields this adapter actually reads are validated strictly; every
// other Cloud API field is left untouched (`.passthrough()` at the leaves
// that matter) rather than modeled, since asserting an exact schema for a
// third-party payload this package can't live-verify against risks
// rejecting valid deliveries over an undocumented field Meta adds later.
const messageSchema = z.object({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).partial().optional(),
  image: z.object({ id: z.string() }).partial().optional(),
  document: z.object({ id: z.string() }).partial().optional(),
}).passthrough();

const valueSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  metadata: z.object({ phone_number_id: z.string().min(1) }).passthrough(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough();

const changeSchema = z.object({
  field: z.string().min(1),
  value: valueSchema,
}).passthrough();

const entrySchema = z.object({
  id: z.string().min(1),
  changes: z.array(changeSchema),
}).passthrough();

export const webhookPayloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(entrySchema),
}).passthrough();

export const supportedInboundContentTypes = ["text", "image", "document"] as const;
export type SupportedInboundContentType = (typeof supportedInboundContentTypes)[number];

export interface NormalizedInboundMessage {
  readonly phoneNumberId: string;
  readonly from: string;
  readonly externalMessageId: string;
  readonly contentType: SupportedInboundContentType;
  readonly body: string | null;
  readonly mediaId: string | null;
  readonly receivedAt: Date;
}

export interface UnsupportedInboundMessage {
  readonly phoneNumberId: string;
  readonly from: string;
  readonly externalMessageId: string;
  readonly rawType: string;
}

export type NormalizedInboundEvent =
  | { readonly kind: "message"; readonly message: NormalizedInboundMessage }
  // WhatsApp message types this adapter doesn't yet map to a
  // packages/conversation content type (audio, video, sticker, location,
  // contacts, interactive, reaction, button, ...). Surfaced rather than
  // dropped or forced into "text", so the Conversation Engine can hand off
  // to a human instead of silently losing the message.
  | { readonly kind: "unsupported_message"; readonly message: UnsupportedInboundMessage }
  // Delivery/read receipts and other non-message notifications. Not a new
  // inbound message; a future delivery-receipt handler is out of this
  // package's scope (see packages/conversation's ConversationEngine,
  // which only owns dialogue, not delivery-receipt bookkeeping).
  | { readonly kind: "status" };

function toContentType(rawType: string): SupportedInboundContentType | null {
  return (supportedInboundContentTypes as readonly string[]).includes(rawType)
    ? (rawType as SupportedInboundContentType)
    : null;
}

function bodyFor(message: z.infer<typeof messageSchema>, contentType: SupportedInboundContentType): string | null {
  return contentType === "text" ? message.text?.body ?? null : null;
}

function mediaIdFor(message: z.infer<typeof messageSchema>, contentType: SupportedInboundContentType): string | null {
  if (contentType === "image") return message.image?.id ?? null;
  if (contentType === "document") return message.document?.id ?? null;
  return null;
}

// Parses a raw WhatsApp Cloud API webhook body into a flat list of
// normalized events, one per message/status entry across every
// entry/change in the payload (Meta batches multiple changes per
// delivery). Throws MalformedWebhookPayloadError for anything that isn't
// shaped like a Cloud API webhook at all, rather than silently returning
// an empty list -- an empty list is indistinguishable from "nothing
// happened" and would hide a real integration break.
export function normalizeInboundPayload(rawPayload: unknown): readonly NormalizedInboundEvent[] {
  const parsed = webhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new MalformedWebhookPayloadError({ cause: parsed.error });
  }

  const events: NormalizedInboundEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const phoneNumberId = change.value.metadata.phone_number_id;
      for (const message of change.value.messages ?? []) {
        const contentType = toContentType(message.type);
        if (!contentType) {
          events.push({
            kind: "unsupported_message",
            message: {
              phoneNumberId,
              from: message.from,
              externalMessageId: message.id,
              rawType: message.type,
            },
          });
          continue;
        }
        events.push({
          kind: "message",
          message: {
            phoneNumberId,
            from: message.from,
            externalMessageId: message.id,
            contentType,
            body: bodyFor(message, contentType),
            mediaId: mediaIdFor(message, contentType),
            receivedAt: new Date(Number(message.timestamp) * 1000),
          },
        });
      }
      change.value.statuses?.forEach(() => events.push({ kind: "status" }));
    }
  }
  return events;
}
