import { WhatsAppDeliveryError } from "./errors";

export type OutboundContentType = "text" | "image" | "document" | "template";

export interface WhatsAppMessageSend {
  readonly to: string;
  readonly contentType: OutboundContentType;
  readonly body: string | null;
  readonly mediaId: string | null;
  readonly templateName: string | null;
}

export interface WhatsAppSendResult {
  readonly externalMessageId: string;
}

// The outbound half of the channel adapter -- ADR 0003: "Channel adapters
// handle transport concerns only ... delivery, and provider-specific error
// mapping." No business logic (what to say, when to say it) lives here;
// packages/conversation's ConversationEngine decides that and calls this
// port with an already-composed message.
export interface WhatsAppSender {
  send(phoneNumberId: string, message: WhatsAppMessageSend): Promise<WhatsAppSendResult>;
}

interface GraphApiPayload {
  readonly messaging_product: "whatsapp";
  readonly to: string;
  readonly type: OutboundContentType;
  readonly text?: { readonly body: string };
  readonly image?: { readonly id: string };
  readonly document?: { readonly id: string };
  readonly template?: { readonly name: string; readonly language: { readonly code: string } };
}

export function toGraphApiPayload(message: WhatsAppMessageSend): GraphApiPayload {
  const base = { messaging_product: "whatsapp" as const, to: message.to, type: message.contentType };
  if (message.contentType === "text") {
    return { ...base, text: { body: message.body ?? "" } };
  }
  if (message.contentType === "image" || message.contentType === "document") {
    return { ...base, [message.contentType]: { id: message.mediaId ?? "" } };
  }
  return { ...base, template: { name: message.templateName ?? "", language: { code: "en" } } };
}

interface GraphApiSendResponse {
  readonly messages?: ReadonlyArray<{ readonly id: string }>;
}

// Meta's Graph API version is a deployment concern, not a domain one --
// callers may override it per environment without this adapter needing a
// code change.
const DEFAULT_GRAPH_API_VERSION = "v21.0";
const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

export class GraphApiWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly graphApiVersion: string = DEFAULT_GRAPH_API_VERSION,
    private readonly timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
  ) {}

  async send(phoneNumberId: string, message: WhatsAppMessageSend): Promise<WhatsAppSendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(toGraphApiPayload(message)),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (cause) {
      const detail = cause instanceof Error && cause.name === "TimeoutError"
        ? "Provider request timed out"
        : "Provider request failed";
      throw new WhatsAppDeliveryError(0, detail);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new WhatsAppDeliveryError(response.status, detail);
    }
    const data = (await response.json()) as GraphApiSendResponse;
    const externalMessageId = data.messages?.[0]?.id;
    if (!externalMessageId) {
      throw new WhatsAppDeliveryError(response.status, "Provider response did not include a message id");
    }
    return { externalMessageId };
  }
}
