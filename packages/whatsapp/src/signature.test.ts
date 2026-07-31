import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./signature";

const appSecret = "test-app-secret";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a signature computed with the correct app secret", () => {
    expect(verifyWebhookSignature(body, sign(body, appSecret), appSecret)).toBe(true);
  });

  it("rejects a signature computed with the wrong app secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "wrong-secret"), appSecret)).toBe(false);
  });

  it("rejects a signature for a different body (payload tampering)", () => {
    const tampered = JSON.stringify({ object: "whatsapp_business_account", entry: [{}] });
    expect(verifyWebhookSignature(tampered, sign(body, appSecret), appSecret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature(body, null, appSecret)).toBe(false);
  });

  it("rejects an unsupported signature scheme", () => {
    expect(verifyWebhookSignature(body, `sha1=${"a".repeat(40)}`, appSecret)).toBe(false);
  });

  it("rejects a non-hex signature value instead of throwing", () => {
    expect(verifyWebhookSignature(body, "sha256=not-hex-zz", appSecret)).toBe(false);
  });
});
