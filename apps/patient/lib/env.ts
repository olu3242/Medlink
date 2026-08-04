import { z } from "zod";

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export function getPublicEnvironment() {
  return publicEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

// Server-only. Never prefix with NEXT_PUBLIC_ -- these must never reach
// the client bundle. Used only by apps/patient/lib/assistant.ts (Alice,
// AG-02) to construct the one real AnthropicMessagesProvider route this
// package wires the AI Gateway to. Kept in its own schema/getter, separate
// from getNotificationEnvironment() below, so Alice's route never fails to
// build or run over an unrelated WhatsApp credential it doesn't use.
const serverEnvironmentSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
});

export function getServerEnvironment() {
  return serverEnvironmentSchema.parse({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  });
}

// Server-only, and narrower still: used only by
// apps/patient/lib/supabase-service-role.ts and the reservations route's
// best-effort outbox dispatch call (G09 minimum slice). A service-role
// key is the same narrow, named exception to "every write goes through
// the session-scoped client" that ADR 0001's amendment (ADR 0004) already
// established for the WhatsApp webhook -- no other request handler in
// this app may construct or use it. WHATSAPP_ACCESS_TOKEN is the worker's
// outbound Graph API credential.
const notificationEnvironmentSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
});

export function getNotificationEnvironment() {
  return notificationEnvironmentSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  });
}
