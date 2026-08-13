import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  inventoryAvailabilitySchema,
  inventoryBatchSchema,
  inventoryTransactionSchema,
  type InventoryManagementRepository,
} from "./management";

interface DatabaseError {
  readonly code?: string;
  readonly message?: string;
}

const batchColumns = `
  id,
  organization_id,
  pharmacy_location_id,
  pharmacy:pharmacy_locations(name,is_active),
  medicine_id,
  medicine:medicines(brand_name,generic_name,strength_display),
  batch_number,
  expires_on,
  supplier_name,
  received_on,
  quantity_on_hand,
  quantity_reserved,
  available_quantity,
  unit,
  unit_price_minor,
  unit_price_currency_code,
  low_stock_threshold,
  status,
  inventory_version,
  created_at,
  updated_at
`;

const batchRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  pharmacy_location_id: z.string().uuid(),
  pharmacy: z.object({
    name: z.string(),
    is_active: z.boolean(),
  }),
  medicine_id: z.string().uuid(),
  medicine: z.object({
    brand_name: z.string(),
    generic_name: z.string(),
    strength_display: z.string(),
  }),
  batch_number: z.string(),
  expires_on: z.string(),
  supplier_name: z.string().nullable(),
  received_on: z.string(),
  quantity_on_hand: z.number().int(),
  quantity_reserved: z.number().int(),
  available_quantity: z.number().int(),
  unit: z.string(),
  unit_price_minor: z.coerce.number().int().min(0).nullable(),
  unit_price_currency_code: z.string().nullable(),
  low_stock_threshold: z.number().int().min(0),
  status: z.enum([
    "available",
    "quarantined",
    "recalled",
    "depleted",
    "expired",
  ]),
  inventory_version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

function availabilityState(row: z.infer<typeof batchRowSchema>) {
  const today = new Date().toISOString().slice(0, 10);
  if (
    !row.pharmacy.is_active
    || ["quarantined", "recalled"].includes(row.status)
  ) return "inactive" as const;
  if (row.status === "expired" || row.expires_on < today) {
    return "expired" as const;
  }
  if (row.available_quantity === 0 && row.quantity_reserved > 0) {
    return "reserved" as const;
  }
  if (row.available_quantity === 0 || row.status === "depleted") {
    return "out_of_stock" as const;
  }
  if (row.available_quantity <= row.low_stock_threshold) {
    return "low_stock" as const;
  }
  return "in_stock" as const;
}

function mapBatch(input: unknown) {
  const row = batchRowSchema.parse(input);
  return inventoryBatchSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    pharmacyLocationId: row.pharmacy_location_id,
    pharmacyName: row.pharmacy.name,
    medicineId: row.medicine_id,
    brandName: row.medicine.brand_name,
    genericName: row.medicine.generic_name,
    strength: row.medicine.strength_display,
    batchNumber: row.batch_number,
    expiresOn: row.expires_on,
    supplier: row.supplier_name,
    receivedOn: row.received_on,
    quantityOnHand: row.quantity_on_hand,
    quantityReserved: row.quantity_reserved,
    availableQuantity: row.available_quantity,
    unit: row.unit,
    unitPriceMinor: row.unit_price_minor,
    currencyCode: row.unit_price_currency_code,
    lowStockThreshold: row.low_stock_threshold,
    recordStatus: row.status,
    availabilityState: availabilityState(row),
    version: row.inventory_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function databaseFailure(error: DatabaseError): never {
  if (["23505", "40001"].includes(error.code ?? "")) {
    throw new RuntimeError(
      "business_rule",
      "inventory_state_conflict",
      "The inventory batch changed or the operation conflicts",
      409,
      false,
      "Refresh inventory and retry with a new idempotency key.",
      { cause: error },
    );
  }
  if (["22023", "23503", "23514"].includes(error.code ?? "")) {
    throw new RuntimeError(
      "validation",
      "inventory_operation_invalid",
      "The inventory operation is invalid",
      422,
      false,
      "Review the batch, quantities, medicine, pharmacy, and expiry.",
      { cause: error },
    );
  }
  if (error.code === "42501") {
    throw new RuntimeError(
      "authorization",
      "inventory_operation_forbidden",
      "The inventory operation is not permitted",
      403,
      false,
      undefined,
      { cause: error },
    );
  }
  throw new RuntimeError(
    "infrastructure",
    "inventory_database_failed",
    "The inventory operation could not be completed",
    503,
    true,
    "Retry later with the same idempotency key.",
    { cause: error },
  );
}

async function result<T>(
  query: PromiseLike<{ data: T; error: DatabaseError | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) databaseFailure(error);
  return data;
}

const transactionRowSchema = z.object({
  id: z.string().uuid(),
  inventory_batch_id: z.string().uuid(),
  transaction_kind: z.enum([
    "receive",
    "dispense",
    "reserve",
    "release",
    "adjustment",
    "expiry",
    "return",
  ]),
  quantity_delta: z.number().int(),
  reserved_delta: z.number().int(),
  quantity_on_hand_before: z.number().int(),
  quantity_on_hand_after: z.number().int(),
  quantity_reserved_before: z.number().int(),
  quantity_reserved_after: z.number().int(),
  reason: z.string(),
  actor_id: z.string().uuid().nullable(),
  occurred_at: z.string(),
});

const availabilityRowSchema = z.object({
  inventory_id: z.string().uuid(),
  pharmacy_location_id: z.string().uuid(),
  pharmacy_name: z.string(),
  medicine_id: z.string().uuid(),
  brand_name: z.string(),
  generic_name: z.string(),
  strength: z.string(),
  batch_number: z.string(),
  expires_on: z.string(),
  available_quantity: z.number().int(),
  unit: z.string(),
  unit_price_minor: z.coerce.number().int().min(0).nullable(),
  currency_code: z.string().nullable(),
  availability_state: z.enum([
    "in_stock",
    "low_stock",
    "reserved",
    "out_of_stock",
    "expired",
    "inactive",
  ]),
});

export class SupabaseInventoryManagementRepository
implements InventoryManagementRepository {
  constructor(private readonly database: SupabaseClient) {}

  async list(input: Parameters<InventoryManagementRepository["list"]>[0]) {
    let statement = this.database.from("inventory_batches")
      .select(batchColumns)
      .eq("organization_id", input.organizationId)
      .is("deleted_at", null)
      .order("expires_on", { ascending: true })
      .limit(500);
    if (input.pharmacyLocationId) {
      statement = statement.eq(
        "pharmacy_location_id",
        input.pharmacyLocationId,
      );
    }
    if (input.medicineId) {
      statement = statement.eq("medicine_id", input.medicineId);
    }
    if (!input.includeInactive) {
      statement = statement.in("status", ["available", "depleted"]);
    }
    return z.array(z.unknown()).parse(await result(statement)).map(mapBatch);
  }

  async find(organizationId: string, inventoryId: string) {
    const { data, error } = await this.database.from("inventory_batches")
      .select(batchColumns)
      .eq("organization_id", organizationId)
      .eq("id", inventoryId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) databaseFailure(error);
    return data === null ? null : mapBatch(data);
  }

  async create(input: Parameters<InventoryManagementRepository["create"]>[0]) {
    const command = z.object({ inventoryId: z.string().uuid() }).parse(
      await result(this.database.rpc("create_inventory_batch", {
        target_organization_id: input.organizationId,
        target_document: input.value,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      })),
    );
    return this.required(input.organizationId, command.inventoryId);
  }

  async update(input: Parameters<InventoryManagementRepository["update"]>[0]) {
    const { expectedVersion, ...document } = input.value;
    const command = z.object({ inventoryId: z.string().uuid() }).parse(
      await result(this.database.rpc("update_inventory_batch", {
        target_organization_id: input.organizationId,
        target_inventory_id: input.inventoryId,
        target_expected_version: expectedVersion,
        target_document: document,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      })),
    );
    return this.required(input.organizationId, command.inventoryId);
  }

  async changeStock(
    input: Parameters<InventoryManagementRepository["changeStock"]>[0],
  ) {
    const command = z.object({ inventoryId: z.string().uuid() }).parse(
      await result(this.database.rpc("change_inventory_stock", {
        target_organization_id: input.organizationId,
        target_inventory_id: input.inventoryId,
        target_expected_version: input.value.expectedVersion,
        target_kind: input.value.kind,
        target_quantity: input.value.quantity,
        target_reason: input.value.reason,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      })),
    );
    return this.required(input.organizationId, command.inventoryId);
  }

  async transactions(organizationId: string, inventoryId: string) {
    const rows = transactionRowSchema.array().parse(await result(
      this.database.from("inventory_transactions")
        .select(
          "id,inventory_batch_id,transaction_kind,quantity_delta,reserved_delta,quantity_on_hand_before,quantity_on_hand_after,quantity_reserved_before,quantity_reserved_after,reason,actor_id,occurred_at",
        )
        .eq("organization_id", organizationId)
        .eq("inventory_batch_id", inventoryId)
        .order("occurred_at", { ascending: false })
        .limit(500),
    ));
    return rows.map((row) => inventoryTransactionSchema.parse({
      id: row.id,
      batchId: row.inventory_batch_id,
      kind: row.transaction_kind,
      quantityDelta: row.quantity_delta,
      reservedDelta: row.reserved_delta,
      quantityOnHandBefore: row.quantity_on_hand_before,
      quantityOnHandAfter: row.quantity_on_hand_after,
      quantityReservedBefore: row.quantity_reserved_before,
      quantityReservedAfter: row.quantity_reserved_after,
      reason: row.reason,
      actorId: row.actor_id,
      occurredAt: row.occurred_at,
    }));
  }

  async availability(
    input: Parameters<InventoryManagementRepository["availability"]>[0],
  ) {
    const rows = availabilityRowSchema.array().parse(await result(
      this.database.rpc("search_inventory_availability", {
        target_organization_id: input.organizationId,
        target_medicine_id: input.medicineId ?? null,
        target_pharmacy_location_id: input.pharmacyLocationId ?? null,
        target_quantity: input.quantity,
      }),
    ));
    return rows.map((row) => inventoryAvailabilitySchema.parse({
      inventoryId: row.inventory_id,
      pharmacyLocationId: row.pharmacy_location_id,
      pharmacyName: row.pharmacy_name,
      medicineId: row.medicine_id,
      brandName: row.brand_name,
      genericName: row.generic_name,
      strength: row.strength,
      batchNumber: row.batch_number,
      expiresOn: row.expires_on,
      availableQuantity: row.available_quantity,
      unit: row.unit,
      unitPriceMinor: row.unit_price_minor,
      currencyCode: row.currency_code,
      state: row.availability_state,
    }));
  }

  private async required(organizationId: string, inventoryId: string) {
    const batch = await this.find(organizationId, inventoryId);
    if (!batch) {
      throw new RuntimeError(
        "infrastructure",
        "inventory_projection_failed",
        "Inventory was saved but could not be projected",
        503,
        true,
      );
    }
    return batch;
  }
}
