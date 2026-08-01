import { describe, expect, it } from "vitest";
import { MalformedWebhookPayloadError } from "./errors";
import { normalizeInboundPayload } from "./payload";

function payloadWithMessage(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "phone-123" },
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

describe("normalizeInboundPayload", () => {
  it("normalizes a text message", () => {
    const events = normalizeInboundPayload(
      payloadWithMessage({
        from: "2348000000001",
        id: "wamid.001",
        timestamp: "1700000000",
        type: "text",
        text: { body: "hello" },
      }),
    );

    expect(events).toEqual([
      {
        kind: "message",
        message: {
          phoneNumberId: "phone-123",
          from: "2348000000001",
          externalMessageId: "wamid.001",
          contentType: "text",
          body: "hello",
          mediaId: null,
          receivedAt: new Date(1700000000 * 1000),
        },
      },
    ]);
  });

  it("normalizes an image message, using its media id rather than text body", () => {
    const events = normalizeInboundPayload(
      payloadWithMessage({
        from: "2348000000001",
        id: "wamid.002",
        timestamp: "1700000001",
        type: "image",
        image: { id: "media-abc" },
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "message",
      message: { contentType: "image", mediaId: "media-abc", body: null },
    });
  });

  it("surfaces an unrecognized message type as unsupported rather than dropping or mis-typing it", () => {
    const events = normalizeInboundPayload(
      payloadWithMessage({
        from: "2348000000001",
        id: "wamid.003",
        timestamp: "1700000002",
        type: "audio",
      }),
    );

    expect(events).toEqual([
      {
        kind: "unsupported_message",
        message: {
          phoneNumberId: "phone-123",
          from: "2348000000001",
          externalMessageId: "wamid.003",
          rawType: "audio",
        },
      },
    ]);
  });

  it("normalizes a status (delivery receipt) notification without treating it as a message", () => {
    const events = normalizeInboundPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "phone-123" },
                statuses: [{ id: "wamid.001", status: "delivered" }],
              },
            },
          ],
        },
      ],
    });

    expect(events).toEqual([{ kind: "status" }]);
  });

  it("flattens messages across multiple entries and changes in one delivery", () => {
    const events = normalizeInboundPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "phone-123" },
                messages: [
                  { from: "1", id: "wamid.a", timestamp: "1700000000", type: "text", text: { body: "a" } },
                ],
              },
            },
          ],
        },
        {
          id: "waba-2",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "phone-456" },
                messages: [
                  { from: "2", id: "wamid.b", timestamp: "1700000001", type: "text", text: { body: "b" } },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => (event.kind === "message" ? event.message.phoneNumberId : null))).toEqual([
      "phone-123",
      "phone-456",
    ]);
  });

  it("throws MalformedWebhookPayloadError for a payload that isn't shaped like a Cloud API webhook, rather than returning an empty list", () => {
    expect(() => normalizeInboundPayload({ hello: "world" })).toThrow(MalformedWebhookPayloadError);
  });
});
