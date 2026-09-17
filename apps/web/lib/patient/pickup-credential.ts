// Client-side pickup credential generation. The plaintext code is
// generated and hashed entirely in the browser using the Web Crypto API
// and is never sent anywhere except back to issue_pickup_credential as a
// hash -- see
// supabase/migrations/202608160035_pickup_credential_authority.sql for why
// the pharmacy and MedLink's own servers must never see or store the
// plaintext.

// Excludes 0/O/1/I/L -- characters easily confused when the patient reads
// the code aloud to pharmacy staff at the counter.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function randomCode(): string {
  // Rejection sampling, not a custom cipher: 256 is not a multiple of
  // ALPHABET.length, so bytes at or above the last full multiple are
  // discarded rather than reduced mod ALPHABET.length, which would bias
  // some characters over others.
  const limit = 256 - (256 % ALPHABET.length);
  let code = "";
  while (code.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH - code.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface PickupCredential {
  readonly code: string;
  readonly hash: string;
}

// Matches apps/pharmacy/lib/reservations.ts's hashPickupCode exactly
// (trim + uppercase before hashing) so the pharmacy's verification hash
// is byte-identical to the one this function sends to
// issue_pickup_credential.
export async function generatePickupCredential(): Promise<PickupCredential> {
  const code = randomCode();
  const hash = await sha256Hex(code.trim().toUpperCase());
  return { code, hash };
}
