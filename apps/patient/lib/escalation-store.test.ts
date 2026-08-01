import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeContext } from "@medlink/runtime";
import { describe, expect, it } from "vitest";
import { SupabaseEscalationStore } from "./escalation-store";

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

const escalationRow = {
  id: "escalation-1",
  organization_id: context.organizationId,
  agent_id: "alice",
  capability_name: "answer_platform_question",
  workflow_type: "alice_conversation",
  subject_id: context.userId,
  status: "pending" as const,
  decided_by: null,
  decision_rationale: null,
};

function fakeDatabase(rpcResult: { data: unknown; error: unknown }, findResult?: { data: unknown; error: unknown }) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const selectCalls: string[] = [];
  const database = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => {
            selectCalls.push(`${table}:${value}`);
            return findResult ?? { data: null, error: null };
          },
        }),
      }),
    }),
  };
  return { database: database as unknown as SupabaseClient, rpcCalls, selectCalls };
}

describe("SupabaseEscalationStore.raise", () => {
  it("calls raise_agent_escalation with the actor/correlation/request/channel from the injected context", async () => {
    const { database, rpcCalls } = fakeDatabase({ data: escalationRow, error: null });
    const store = new SupabaseEscalationStore(database, context);

    const result = await store.raise({
      organizationId: context.organizationId,
      agentId: "alice",
      capabilityName: "answer_platform_question",
      workflowType: "alice_conversation",
      subjectId: context.userId,
      idempotencyKey: "alice:correlation-1",
      payload: { reason: "patient_question_requires_clinical_judgment" },
    });

    expect(result).toEqual({
      id: "escalation-1",
      organizationId: context.organizationId,
      agentId: "alice",
      capabilityName: "answer_platform_question",
      workflowType: "alice_conversation",
      subjectId: context.userId,
      status: "pending",
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      fn: "raise_agent_escalation",
      args: {
        target_organization_id: context.organizationId,
        target_actor_id: context.userId,
        target_correlation_id: context.correlationId,
        target_request_id: context.requestId,
        target_channel: context.channel,
        target_idempotency_key: "alice:correlation-1",
        target_agent_id: "alice",
        target_capability_name: "answer_platform_question",
        target_workflow_type: "alice_conversation",
        target_subject_id: context.userId,
        target_payload: { reason: "patient_question_requires_clinical_judgment" },
      },
    });
  });

  it("throws an infrastructure RuntimeError on an RPC failure", async () => {
    const { database } = fakeDatabase({ data: null, error: { message: "db down" } });
    const store = new SupabaseEscalationStore(database, context);
    await expect(
      store.raise({
        organizationId: context.organizationId,
        agentId: "alice",
        capabilityName: "answer_platform_question",
        workflowType: "alice_conversation",
        subjectId: context.userId,
        idempotencyKey: "alice:correlation-1",
      }),
    ).rejects.toMatchObject({ category: "infrastructure", status: 503 });
  });

  it("defaults payload to an empty object when none is provided", async () => {
    const { database, rpcCalls } = fakeDatabase({ data: escalationRow, error: null });
    const store = new SupabaseEscalationStore(database, context);
    await store.raise({
      organizationId: context.organizationId,
      agentId: "alice",
      capabilityName: "answer_platform_question",
      workflowType: "alice_conversation",
      subjectId: context.userId,
      idempotencyKey: "alice:correlation-1",
    });
    expect(rpcCalls[0]?.args).toMatchObject({ target_payload: {} });
  });
});

describe("SupabaseEscalationStore.decide", () => {
  it("calls decide_agent_escalation with the pharmacist's decision", async () => {
    const decidedRow = { ...escalationRow, status: "approved" as const, decided_by: context.userId, decision_rationale: "ok" };
    const { database, rpcCalls } = fakeDatabase({ data: decidedRow, error: null });
    const store = new SupabaseEscalationStore(database, { ...context, role: "pharmacist" });

    const result = await store.decide({
      escalationId: "escalation-1",
      decidedBy: context.userId,
      status: "approved",
      rationale: "ok",
    });

    expect(result.status).toBe("approved");
    expect(result.decidedBy).toBe(context.userId);
    expect(result.decisionRationale).toBe("ok");
    expect(rpcCalls[0]).toMatchObject({
      fn: "decide_agent_escalation",
      args: {
        target_escalation_id: "escalation-1",
        target_status: "approved",
        target_rationale: "ok",
      },
    });
  });
});

describe("SupabaseEscalationStore.find", () => {
  it("returns null when no escalation exists", async () => {
    const { database } = fakeDatabase({ data: null, error: null }, { data: null, error: null });
    const store = new SupabaseEscalationStore(database, context);
    expect(await store.find("missing")).toBeNull();
  });

  it("maps a found row to AgentEscalation", async () => {
    const { database } = fakeDatabase({ data: null, error: null }, { data: escalationRow, error: null });
    const store = new SupabaseEscalationStore(database, context);
    const result = await store.find("escalation-1");
    expect(result?.id).toBe("escalation-1");
    expect(result?.status).toBe("pending");
  });
});
