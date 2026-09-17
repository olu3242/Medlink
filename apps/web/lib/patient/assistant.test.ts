import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeModelProvider } from "@medlink/ai";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { AssistantApplication } from "./assistant";

const context: RuntimeContext = {
  correlationId: "correlation-1",
  requestId: "request-1",
  tenantId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  role: "patient",
  locale: "en-US",
  timezone: "UTC",
  channel: "web",
  apiVersion: "v1",
};

function fakeDatabase(rpcResult: { data: unknown; error: unknown }) {
  const database = { rpc: async () => rpcResult };
  return database as unknown as SupabaseClient;
}

describe("AssistantApplication.ask", () => {
  it("answers a platform question end to end using an injected provider", async () => {
    const provider = new FakeModelProvider("fake-anthropic", (request) => ({
      text: `Answer: ${request.prompt}`,
      modelId: "fake-anthropic",
      inputTokens: 10,
      outputTokens: 5,
    }));
    const database = fakeDatabase({ data: null, error: null });
    const app = new AssistantApplication(database, provider);

    const response = await app.ask(context, {
      capability: "answer_platform_question",
      question: "How do I check my order status?",
    });

    expect(response.kind).toBe("answer");
  });

  it("escalates through the real Supabase-backed store when the guardrail trips", async () => {
    const provider = new FakeModelProvider("fake-anthropic");
    const escalationRow = {
      id: "escalation-1",
      organization_id: context.organizationId,
      agent_id: "alice",
      capability_name: "answer_platform_question",
      workflow_type: "alice_conversation",
      subject_id: context.userId,
      status: "pending",
      decided_by: null,
      decision_rationale: null,
    };
    const database = fakeDatabase({ data: escalationRow, error: null });
    const app = new AssistantApplication(database, provider);

    const response = await app.ask(context, {
      capability: "answer_platform_question",
      question: "Should I take this with food?",
    });

    expect(response.kind).toBe("escalated");
    if (response.kind === "escalated") {
      expect(response.escalationId).toBe("escalation-1");
    }
  });
});
