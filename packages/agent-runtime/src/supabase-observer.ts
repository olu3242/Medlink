import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTaskObserver, AgentTaskTelemetry } from "./contracts";

export class SupabaseAgentTaskObserver implements AgentTaskObserver {
  constructor(private readonly database: SupabaseClient) {}

  async record(event: AgentTaskTelemetry): Promise<void> {
    const actorId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.actor)
      ? event.actor
      : null;
    const { error } = await this.database.rpc("record_governed_agent_task_event", {
      target_organization_id: event.tenantId,
      target_actor_id: actorId,
      target_agent_id: event.agentId,
      target_agent_version: event.agentVersion,
      target_capability: event.capability,
      target_persona: event.persona,
      target_workflow_id: event.context.workflowId ?? null,
      target_conversation_id: event.context.conversationId ?? null,
      target_correlation_id: event.correlationId,
      target_task_id: event.taskId,
      target_status: event.status,
      target_duration_ms: Math.round(event.durationMs),
      target_requires_human_approval: event.requiresHumanApproval,
      target_error_code: event.errorCode ?? null,
      target_prescription_id: event.context.prescriptionId ?? null,
      target_mar_id: event.context.marId ?? null,
    });
    if (error) throw new RuntimeError(
      "infrastructure",
      "agent_evidence_write_failed",
      "Governed agent execution evidence could not be recorded",
      503,
      true,
      "Retry with the same task identifier.",
      { cause: error },
    );
  }
}
