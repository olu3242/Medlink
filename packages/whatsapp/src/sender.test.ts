import { describe, expect, it, vi } from "vitest";
import { WhatsAppDeliveryError } from "./errors";
import { GraphApiWhatsAppSender, toGraphApiPayload } from "./sender";

describe("toGraphApiPayload", () => {
  it("maps a text message to the Graph API shape", () => {
    expect(
      toGraphApiPayload({ to: "234800", contentType: "text", body: "hi", mediaId: null, templateName: null }),
    ).toEqual({ messaging_product: "whatsapp", to: "234800", type: "text", text: { body: "hi" } });
  });

  it("maps an image message using its media id, not a body", () => {
    expect(
      toGraphApiPayload({ to: "234800", contentType: "image", body: null, mediaId: "media-1", templateName: null }),
    ).toEqual({ messaging_product: "whatsapp", to: "234800", type: "image", image: { id: "media-1" } });
  });

  it("maps a template message using its template name", () => {
    expect(
      toGraphApiPayload({ to: "234800", contentType: "template", body: null, mediaId: null, templateName: "welcome" }),
    ).toEqual({
      messaging_product: "whatsapp",
      to: "234800",
      type: "template",
      template: { name: "welcome", language: { code: "en" } },
    });
  });
});

describe("GraphApiWhatsAppSender", () => {
  it("sends through the injected fetch implementation and returns the provider's message id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.reply.001" }] }), { status: 200 }),
    );
    const sender = new GraphApiWhatsAppSender("token-123", fetchImpl);

    const result = await sender.send("phone-123", {
      to: "234800",
      contentType: "text",
      body: "hi",
      mediaId: null,
      templateName: null,
    });

    expect(result).toEqual({ externalMessageId: "wamid.reply.001" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/phone-123/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer token-123" }),
      }),
    );
  });

  it("throws WhatsAppDeliveryError when the provider responds with a non-2xx status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const sender = new GraphApiWhatsAppSender("token-123", fetchImpl);

    await expect(
      sender.send("phone-123", { to: "234800", contentType: "text", body: "hi", mediaId: null, templateName: null }),
    ).rejects.toThrow(WhatsAppDeliveryError);
  });

  it("throws WhatsAppDeliveryError when the provider omits a message id despite a 2xx status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const sender = new GraphApiWhatsAppSender("token-123", fetchImpl);

    await expect(
      sender.send("phone-123", { to: "234800", contentType: "text", body: "hi", mediaId: null, templateName: null }),
    ).rejects.toThrow(WhatsAppDeliveryError);
  });
});
