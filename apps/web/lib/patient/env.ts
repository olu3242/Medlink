import { z } from "zod";

// Server-only. Never prefix with NEXT_PUBLIC_ -- these must never reach
// the client bundle. Used only by apps/patient/lib/assistant.ts (Alice,
// AG-02) to construct the one real AnthropicMessagesProvider route this
// package wires the AI Gateway to.
const serverEnvironmentSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1),
  ANTHROPIC_ENDPOINT: z.string().url().optional(),
});

export function getServerEnvironment() {
  return serverEnvironmentSchema.parse({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ANTHROPIC_ENDPOINT: process.env.ANTHROPIC_ENDPOINT,
  });
}
