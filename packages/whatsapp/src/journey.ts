import { createHash } from "node:crypto";
import {
  normalizeWhatsAppPayload,
  WhatsAppSignatureVerifier,
  type WhatsAppProvider,
} from "./index";

export interface JourneySession {
  readonly id: string;
  readonly tenantId: string;
  readonly identityHash: string;
  readonly consented: boolean;
}

export interface WhatsAppJourneyStore {
  session(tenantId: string, identityHash: string): Promise<JourneySession>;
  claim(providerMessageId: string): Promise<boolean>;
  record(input: {
    sessionId: string;
    providerMessageId: string;
    kind: string;
    mediaType?: string;
  }): Promise<void>;
}

export interface JourneyIntentRouter {
  route(input: {
    session: JourneySession;
    text?: string;
    hasMedia: boolean;
  }): Promise<{ reply: string; handoff: boolean }>;
}

export class WhatsAppJourney {
  constructor(
    private readonly verifier: WhatsAppSignatureVerifier,
    private readonly provider: WhatsAppProvider,
    private readonly store: WhatsAppJourneyStore,
    private readonly router: JourneyIntentRouter,
  ) {}

  async accept(input: {
    tenantId: string;
    body: Uint8Array;
    signature: string;
    payload: unknown;
  }): Promise<{ duplicate: boolean; handoff?: boolean; outboundId?: string }> {
    if (!this.verifier.verify(input.body, input.signature)) {
      throw new Error("Invalid WhatsApp signature");
    }
    const message = normalizeWhatsAppPayload(input.payload);
    if (!await this.store.claim(message.providerMessageId)) return { duplicate: true };
    const identityHash = createHash("sha256").update(message.identity).digest("hex");
    const session = await this.store.session(input.tenantId, identityHash);
    if (!session.consented) throw new Error("WhatsApp consent is required");
    const media = message.mediaId
      ? await this.provider.downloadMedia(message.mediaId)
      : undefined;
    await this.store.record({
      sessionId: session.id,
      providerMessageId: message.providerMessageId,
      kind: message.kind,
      ...(media ? { mediaType: media.mediaType } : {}),
    });
    const intent = await this.router.route({
      session,
      ...(message.text ? { text: message.text } : {}),
      hasMedia: media !== undefined,
    });
    const sent = await this.provider.send({
      to: message.identity,
      body: intent.reply,
      idempotencyKey: `whatsapp:${message.providerMessageId}:reply`,
    });
    return {
      duplicate: false,
      handoff: intent.handoff,
      outboundId: sent.providerMessageId,
    };
  }
}
