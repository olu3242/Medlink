import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentEscalation, DecideEscalationInput, EscalationStore, RaiseEscalationInput } from "@medlink/agents";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";

function infrastructureError(cause: unknown): RuntimeError {
  return new RuntimeError(
    "infrastructure",
    "database_operation_failed",
    "The data operation could not be completed",
    503,
    true,
    "Retry later.",
    { cause },
  );
}

interface AgentEscalationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly agent_id: string;
  readonly capability_name: string;
  readonly workflow_type: string;
  readonly subject_id: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly decided_by: string | null;
  readonly decision_rationale: string | null;
}

function toAgentEscalation(row: AgentEscalationRow): AgentEscalation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    capabilityName: row.capability_name,
    workflowType: row.workflow_type,
    subjectId: row.subject_id,
    status: row.status,
    ...(row.decided_by !== null ? { decidedBy: row.decided_by } : {}),
    ...(row.decision_rationale !== null ? { decisionRationale: row.decision_rationale } : {}),
  };
}

// Supabase-backed EscalationStore (@medlink/agents), calling AGL-5's real
// RPCs (migration 202607310002) instead of the in-memory store every
// existing agents test uses. The in-memory store is correct for tests but
// would silently lose every escalation on a real, stateless API route --
// this adapter is what makes Alice's escalation path actually durable in
// production, following the same "adapter lives in the consuming app"
// pattern as SupabasePrescriptionFileStore.
export class SupabaseEscalationStore implements EscalationStore {
  constructor(
    private readonly database: SupabaseClient,
    private readonly context: RuntimeContext,
  ) {}

  async raise(input: RaiseEscalationInput): Promise<AgentEscalation> {
    const { data, error } = await this.database.rpc("raise_agent_escalation", {
      target_organization_id: input.organizationId,
      target_actor_id: this.context.userId,
      target_correlation_id: this.context.correlationId,
      target_request_id: this.context.requestId,
      target_idempotency_key: input.idempotencyKey,
      target_channel: this.context.channel,
      target_agent_id: input.agentId,
      target_capability_name: input.capabilityName,
      target_workflow_type: input.workflowType,
      target_subject_id: input.subjectId,
      target_payload: input.payload ?? {},
    });
    if (error) throw infrastructureError(error);
    return toAgentEscalation(data as AgentEscalationRow);
  }

  async decide(input: DecideEscalationInput): Promise<AgentEscalation> {
    const { data, error } = await this.database.rpc("decide_agent_escalation", {
      target_organization_id: this.context.organizationId,
      target_actor_id: this.context.userId,
      target_correlation_id: this.context.correlationId,
      target_request_id: this.context.requestId,
      target_idempotency_key: `${input.escalationId}:${input.status}`,
      target_channel: this.context.channel,
      target_escalation_id: input.escalationId,
      target_status: input.status,
      target_rationale: input.rationale,
    });
    if (error) throw infrastructureError(error);
    return toAgentEscalation(data as AgentEscalationRow);
  }

  async find(escalationId: string): Promise<AgentEscalation | null> {
    const { data, error } = await this.database
      .from("agent_escalations")
      .select("*")
      .eq("id", escalationId)
      .maybeSingle<AgentEscalationRow>();
    if (error) throw infrastructureError(error);
    return data ? toAgentEscalation(data) : null;
  }
}
