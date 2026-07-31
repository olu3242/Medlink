import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateReservationInput,
  CreatedReservation,
  ReservationCreator,
} from "@medlink/workflows";
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

interface ReserveInventoryRpcRow {
  id: string;
  status: string;
}

// Bridges packages/workflows' ReservationCreator port to the atomic
// reserve_inventory RPC (migration 202607290010) -- the same
// "no HTTP request of its own" reasoning apps/web/lib/mar-creator.ts's
// SupabaseMarCreator documents.
export class SupabaseReservationCreator implements ReservationCreator {
  constructor(private readonly database: SupabaseClient) {}

  async createReservation(input: CreateReservationInput): Promise<CreatedReservation> {
    const { data, error } = await this.database.rpc("reserve_inventory", {
      target_organization_id: input.organizationId,
      target_actor_id: input.actorId,
      target_correlation_id: input.idempotencyKey,
      target_request_id: randomUUID(),
      target_idempotency_key: input.idempotencyKey,
      target_channel: "workflow",
      target_mar_id: input.marId,
      target_pharmacy_location_id: input.pharmacyLocationId,
      target_inventory_batch_id: input.inventoryBatchId,
      target_quantity: input.quantity,
      target_expires_at: input.expiresAt,
    });
    if (error) throw infrastructureError(error);
    const row = data as ReserveInventoryRpcRow;
    return { id: row.id, status: row.status };
  }
}
