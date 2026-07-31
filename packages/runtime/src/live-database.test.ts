import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const key = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const live = url && key ? describe : describe.skip;

live("live transactional runtime", () => {
  const anonymousDenyTables = [
    "organizations",
    "runtime_outbox_events",
    "notification_outbox",
    "notification_delivery_attempts",
    "integration_webhook_messages",
    "integration_delivery_attempts",
    "api_client_credentials",
  ] as const;

  const database = () =>
    createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  it.each(anonymousDenyTables)(
    "denies anonymous rows from %s without hiding the schema",
    async (table) => {
      const { data, error } = await database()
        .from(table)
        .select("id")
        .limit(1);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    },
  );

  it("keeps the runtime outbox available through PostgREST behind RLS", async () => {
    const { data, error } = await database()
      .from("runtime_outbox_events")
      .select("id")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeInstanceOf(Array);
  });
});
