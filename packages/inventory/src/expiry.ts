import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const inventoryExpiryResultSchema = z.object({
  releasedHolds: z.number().int().min(0),
  expiredBatches: z.number().int().min(0),
}).strict();

export type InventoryExpiryResult = z.infer<
  typeof inventoryExpiryResultSchema
>;

export interface InventoryExpiryRepository {
  releaseExpired(limit: number): Promise<InventoryExpiryResult>;
}

export class InventoryExpiryWorker {
  constructor(private readonly repository: InventoryExpiryRepository) {}

  run(limit = 100) {
    return this.repository.releaseExpired(
      z.number().int().min(1).max(1_000).parse(limit),
    );
  }
}

export class SupabaseInventoryExpiryRepository
implements InventoryExpiryRepository {
  constructor(private readonly database: SupabaseClient) {}

  async releaseExpired(limit: number) {
    const { data, error } = await this.database.rpc(
      "release_expired_inventory_holds",
      { target_limit: limit },
    );
    if (error) {
      throw new RuntimeError(
        "infrastructure",
        "inventory_expiry_failed",
        "Expired inventory could not be reconciled",
        503,
        true,
        "Retry with the same worker schedule.",
        { cause: error },
      );
    }
    return inventoryExpiryResultSchema.parse(data);
  }
}
