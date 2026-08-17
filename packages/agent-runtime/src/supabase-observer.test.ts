import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseAgentTaskObserver } from "./supabase-observer";

const event = {
  taskId: "task-1",
  correlationId: "correlation-1",
  tenantId: "11111111-1111-4111-8111-111111111111",
  engine: "ML-ENG-013",
  capability: "extract_prescription",
  action: "ocr",
  actor: "22222222-2222-4222-8222-222222222222",
  agentId: "ocr",
  agentVersion: "1.0.0",
  persona: "patient",
  requiresHumanApproval: false,
  context: {
    tenantId: "11111111-1111-4111-8111-111111111111",
    prescriptionId: "33333333-3333-4333-8333-333333333333",
    workflowId: "workflow-1",
    conversationId: "conversation-1",
  },
  status: "completed" as const,
  durationMs: 12.6,
};

describe("SupabaseAgentTaskObserver", () => {
  it("writes bounded durable task evidence without input or output payloads", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await new SupabaseAgentTaskObserver({ rpc } as unknown as SupabaseClient)
      .record(event);

    expect(rpc).toHaveBeenCalledWith("record_governed_agent_task_event", {
      target_organization_id: event.tenantId,
      target_actor_id: event.actor,
      target_agent_id: "ocr",
      target_agent_version: "1.0.0",
      target_capability: "extract_prescription",
      target_persona: "patient",
      target_workflow_id: "workflow-1",
      target_conversation_id: "conversation-1",
      target_correlation_id: "correlation-1",
      target_task_id: "task-1",
      target_status: "completed",
      target_duration_ms: 13,
      target_requires_human_approval: false,
      target_error_code: null,
      target_prescription_id: event.context.prescriptionId,
      target_mar_id: null,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("input");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("output");
  });

  it("fails closed when durable evidence cannot be written", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "denied" } }));
    await expect(new SupabaseAgentTaskObserver(
      { rpc } as unknown as SupabaseClient,
    ).record(event)).rejects.toMatchObject({ code: "agent_evidence_write_failed" });
  });
});
