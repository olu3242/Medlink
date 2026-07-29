import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkflowInstance, WorkflowStore } from "@medlink/workflows";
import { RuntimeError } from "@medlink/runtime";

// Supabase-backed WorkflowStore for packages/workflows' WorkflowService,
// against migration 202607290015's workflow_instances table -- the same
// "adapter lives in the consuming app" pattern
// apps/admin/lib/medicine-repository.ts and
// apps/web/lib/conversation-store.ts already established.

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

interface WorkflowInstanceRow {
  id: string;
  organization_id: string;
  type: string;
  status: string;
  completed_steps: string[];
  context: Record<string, unknown>;
}

export function toWorkflowInstance(row: WorkflowInstanceRow): WorkflowInstance {
  if (row.status !== "running" && row.status !== "completed" && row.status !== "failed") {
    throw new Error(`Unknown workflow_instances.status '${row.status}'`);
  }
  return {
    id: row.id,
    tenantId: row.organization_id,
    type: row.type,
    status: row.status,
    completedSteps: row.completed_steps,
    context: row.context,
  };
}

export class SupabaseWorkflowStore implements WorkflowStore {
  constructor(private readonly database: SupabaseClient) {}

  async findByKey(tenantId: string, key: string): Promise<WorkflowInstance | null> {
    const { data, error } = await this.database.from("workflow_instances")
      .select("*")
      .eq("organization_id", tenantId)
      .eq("idempotency_key", key)
      .maybeSingle<WorkflowInstanceRow>();
    if (error) throw infrastructureError(error);
    return data ? toWorkflowInstance(data) : null;
  }

  async create(input: {
    tenantId: string;
    type: string;
    idempotencyKey: string;
    context?: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInstance> {
    const { data, error } = await this.database.from("workflow_instances")
      .insert({
        organization_id: input.tenantId,
        type: input.type,
        idempotency_key: input.idempotencyKey,
        ...(input.context ? { context: input.context } : {}),
      })
      .select("*")
      .single<WorkflowInstanceRow>();
    if (error) throw infrastructureError(error);
    return toWorkflowInstance(data);
  }

  async markStep(
    id: string,
    step: string,
    contextPatch: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowInstance> {
    const { data: current, error: readError } = await this.database.from("workflow_instances")
      .select("*")
      .eq("id", id)
      .single<WorkflowInstanceRow>();
    if (readError) throw infrastructureError(readError);

    const { data, error } = await this.database.from("workflow_instances")
      .update({
        completed_steps: [...current.completed_steps, step],
        context: { ...current.context, ...contextPatch },
      })
      .eq("id", id)
      .select("*")
      .single<WorkflowInstanceRow>();
    if (error) throw infrastructureError(error);
    return toWorkflowInstance(data);
  }

  async complete(id: string): Promise<WorkflowInstance> {
    const { data, error } = await this.database.from("workflow_instances")
      .update({ status: "completed" })
      .eq("id", id)
      .select("*")
      .single<WorkflowInstanceRow>();
    if (error) throw infrastructureError(error);
    return toWorkflowInstance(data);
  }
}
