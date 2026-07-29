import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Static RLS assertions for Wave 3 Batch 3.1's Conversation Engine schema
// (docs/audit/RC1_BACKLOG.md P1 item 14), the same "fails loudly if a
// future migration edit drops RLS or a policy" role wave2-rls.test.ts
// plays for Wave 2 -- not a substitute for a live cross-tenant denial
// matrix, which still needs a running PostgreSQL/Supabase instance this
// sandbox cannot reach.
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "202607290012_conversation_engine.sql"),
  "utf8",
).toLowerCase();

describe("wave 3 conversation engine table RLS", () => {
  const tablesWithPolicies: Record<string, readonly string[]> = {
    conversations: ["conversations_read", "conversations_admin_manage"],
    conversation_messages: ["conversation_messages_read"],
    conversation_events: ["conversation_events_read"],
  };

  it.each(Object.entries(tablesWithPolicies))(
    "enables RLS on %s and defines its policies",
    (table, policies) => {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      for (const policy of policies) {
        expect(sql).toContain(`create policy ${policy}`);
      }
    },
  );

  it("has no authenticated write policy for conversation_messages or conversation_events (worker-only via the service role)", () => {
    expect(sql).not.toContain("create policy conversation_messages_create");
    expect(sql).not.toContain("create policy conversation_messages_admin");
    expect(sql).not.toContain("create policy conversation_events_create");
    expect(sql).not.toContain("create policy conversation_events_admin");
  });

  it("blocks updates and deletes on conversation_events outright, not just by role", () => {
    expect(sql).toContain("before update or delete on public.conversation_events");
    expect(sql).toContain("execute function public.prevent_enterprise_event_mutation()");
  });

  it("scopes conversation read access to the linked patient or an org admin", () => {
    const policyStart = sql.indexOf("create policy conversations_read");
    const policyBody = sql.slice(policyStart, policyStart + 400);
    expect(policyBody).toContain("patient_id = auth.uid()");
    expect(policyBody).toContain("platform_admin");
  });

  it("deduplicates inbound provider messages per organization", () => {
    expect(sql).toContain("unique (organization_id, external_message_id)");
  });
});
