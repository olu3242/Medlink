import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppSignatureVerifier } from "./index";
import { WhatsAppJourney } from "./journey";

describe("website-independent WhatsApp journey", () => {
  it("verifies, deduplicates, downloads media, routes, and replies", async () => {
    const secret = "test-secret";
    const body = new TextEncoder().encode('{"event":"message"}');
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    let claimed = false;
    const downloadMedia = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/jpeg",
    }));
    const send = vi.fn(async () => ({ providerMessageId: "outbound-1" }));
    const journey = new WhatsAppJourney(
      new WhatsAppSignatureVerifier(secret),
      { downloadMedia, send },
      {
        session: async (tenantId, identityHash) => ({
          id: "session-1",
          tenantId,
          identityHash,
          consented: true,
        }),
        claim: async () => {
          if (claimed) return false;
          claimed = true;
          return true;
        },
        record: async () => undefined,
      },
      { route: async () => ({ reply: "A pharmacist will review this.", handoff: true }) },
    );
    const payload = {
      eventId: "event-1",
      messageId: "message-1",
      from: "+15550000000",
      kind: "image",
      mediaId: "media-1",
    };

    const first = await journey.accept({ tenantId: "tenant-1", body, signature, payload });
    const replay = await journey.accept({ tenantId: "tenant-1", body, signature, payload });

    expect(first).toEqual({
      duplicate: false,
      handoff: true,
      outboundId: "outbound-1",
    });
    expect(replay).toEqual({ duplicate: true });
    expect(downloadMedia).toHaveBeenCalledWith("media-1");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "whatsapp:message-1:reply",
    }));
  });
});
