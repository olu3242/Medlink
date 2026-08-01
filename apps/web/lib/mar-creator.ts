import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateMarInput, CreatedMar, MarCreator } from "@medlink/workflows";
import { RuntimeError } from "@medlink/runtime";

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

interface CreateMarRpcRow {
  id: string;
  state: string;
}

// Bridges packages/workflows' MarCreator port to the atomic create_mar RPC
// (migration 202607290016). A workflow-invoked creation has no HTTP
// request of its own to derive correlation/request identifiers from --
// packages/conversation's InboundMessageInput doesn't propagate one yet
// either (a known gap, not solved here) -- so this generates a fresh
// request id and uses the caller's idempotency key as the correlation id,
// tagging the channel "workflow" rather than "api" so this origin is
// distinguishable in governance_audit_events.
export class SupabaseMarCreator implements MarCreator {
  constructor(private readonly database: SupabaseClient) {}

  async createMar(input: CreateMarInput): Promise<CreatedMar> {
    const { data, error } = await this.database.rpc("create_mar", {
      target_organization_id: input.organizationId,
      target_actor_id: input.actorId,
      target_correlation_id: input.idempotencyKey,
      target_request_id: randomUUID(),
      target_idempotency_key: input.idempotencyKey,
      target_channel: "workflow",
      target_patient_id: input.patientId,
      target_prescription_id: input.prescriptionId,
      target_requested_medicine_id: input.medicineId,
      target_patient_notes: input.notes,
    });
    if (error) throw infrastructureError(error);
    const row = data as CreateMarRpcRow;
    return { id: row.id, state: row.state };
  }
}
