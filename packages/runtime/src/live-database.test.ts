import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const key = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const live = url && key ? describe : describe.skip;

live("live transactional runtime", () => {
  it("exposes the runtime outbox behind RLS", async () => {
    const database = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await database
      .from("runtime_outbox_events")
      .select("id")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeInstanceOf(Array);
  });
});
