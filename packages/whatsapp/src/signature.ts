import { createHmac, timingSafeEqual } from "node:crypto";

// Meta's WhatsApp Cloud API signs every webhook delivery with
// `X-Hub-Signature-256: sha256=<hex hmac of the raw request body>`, keyed by
// the app secret configured in the Meta developer console. Per
// docs/ENTERPRISE_RUNTIME_CONTRACT.md's Conversation Runtime profile,
// "Verify provider authenticity before parsing content" is the mandatory
// first stage -- this is that check. It operates on the *raw* request body
// text, not a re-serialized JSON object, since re-serialization is not
// guaranteed byte-identical to what Meta signed.
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const [scheme, hex] = signatureHeader.split("=");
  if (scheme !== "sha256" || !hex) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  let provided: Buffer;
  try {
    provided = Buffer.from(hex, "hex");
  } catch {
    return false;
  }
  // timingSafeEqual throws on length mismatch rather than returning false;
  // an invalid signature must never leak length information through a
  // thrown-vs-returned distinction, so the length check happens first.
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
