import { RuntimeError } from "@medlink/runtime";
import { z } from "zod";

const bounded = (maximum: number) => z.string().trim().min(1).max(maximum);

export const inventoryBatchStatusSchema = z.enum([
  "available",
  "quarantined",
  "recalled",
  "depleted",
  "expired",
]);

export const inventoryAvailabilityStateSchema = z.enum([
  "in_stock",
  "low_stock",
  "reserved",
  "out_of_stock",
  "expired",
  "inactive",
]);

export const stockTransactionKindSchema = z.enum([
  "receive",
  "dispense",
  "reserve",
  "release",
  "adjustment",
  "expiry",
  "return",
]);

export const inventoryBatchSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  pharmacyName: z.string(),
  medicineId: z.string().uuid(),
  brandName: z.string(),
  genericName: z.string(),
  strength: z.string(),
  batchNumber: z.string(),
  expiresOn: z.string().date(),
  supplier: z.string().nullable(),
  receivedOn: z.string().date(),
  quantityOnHand: z.number().int().min(0),
  quantityReserved: z.number().int().min(0),
  availableQuantity: z.number().int().min(0),
  unit: z.string(),
  unitPriceMinor: z.number().int().min(0).nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  lowStockThreshold: z.number().int().min(0),
  recordStatus: inventoryBatchStatusSchema,
  availabilityState: inventoryAvailabilityStateSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const pricingShape = z.object({
  unitPriceMinor: z.number().int().min(0).nullable().optional(),
  currencyCode: z.string().trim().toUpperCase()
    .regex(/^[A-Z]{3}$/).nullable().optional(),
}).superRefine((value, context) => {
  const price = value.unitPriceMinor ?? null;
  const currency = value.currencyCode ?? null;
  if ((price === null) !== (currency === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currencyCode"],
      message: "Unit price and currency must be supplied together",
    });
  }
});

export const createInventoryBatchSchema = z.object({
  pharmacyLocationId: z.string().uuid(),
  medicineId: z.string().uuid(),
  batchNumber: bounded(120),
  expiresOn: z.string().date(),
  supplier: bounded(240).nullable().optional(),
  receivedOn: z.string().date().optional(),
  quantity: z.number().int().positive(),
  unit: bounded(40),
  unitPriceMinor: z.number().int().min(0).nullable().optional(),
  currencyCode: z.string().trim().toUpperCase()
    .regex(/^[A-Z]{3}$/).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).default(5),
}).strict().and(pricingShape);

export const updateInventoryBatchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expiresOn: z.string().date(),
  supplier: bounded(240).nullable().optional(),
  receivedOn: z.string().date(),
  unit: bounded(40),
  unitPriceMinor: z.number().int().min(0).nullable().optional(),
  currencyCode: z.string().trim().toUpperCase()
    .regex(/^[A-Z]{3}$/).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000),
  status: inventoryBatchStatusSchema,
}).strict().and(pricingShape);

export const changeInventoryStockSchema = z.object({
  expectedVersion: z.number().int().positive(),
  kind: z.enum(["receive", "dispense", "adjustment", "return"]),
  quantity: z.number().int().refine((value) => value !== 0, {
    message: "Stock quantity cannot be zero",
  }),
  reason: bounded(1000),
}).strict().superRefine((value, context) => {
  if (
    ["receive", "dispense", "return"].includes(value.kind)
    && value.quantity < 1
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantity"],
      message: `${value.kind} quantity must be positive`,
    });
  }
});

export const inventoryTransactionSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  kind: stockTransactionKindSchema,
  quantityDelta: z.number().int(),
  reservedDelta: z.number().int(),
  quantityOnHandBefore: z.number().int().min(0),
  quantityOnHandAfter: z.number().int().min(0),
  quantityReservedBefore: z.number().int().min(0),
  quantityReservedAfter: z.number().int().min(0),
  reason: z.string(),
  actorId: z.string().uuid().nullable(),
  occurredAt: z.string(),
}).strict();

export const inventoryAvailabilitySchema = z.object({
  inventoryId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  pharmacyName: z.string(),
  medicineId: z.string().uuid(),
  brandName: z.string(),
  genericName: z.string(),
  strength: z.string(),
  batchNumber: z.string(),
  expiresOn: z.string().date(),
  availableQuantity: z.number().int().min(0),
  unit: z.string(),
  unitPriceMinor: z.number().int().min(0).nullable(),
  currencyCode: z.string().nullable(),
  state: inventoryAvailabilityStateSchema,
}).strict();

export type InventoryBatch = z.infer<typeof inventoryBatchSchema>;
export type InventoryTransaction = z.infer<typeof inventoryTransactionSchema>;
export type InventoryAvailabilityProjection = z.infer<
  typeof inventoryAvailabilitySchema
>;

export interface InventoryManagementRepository {
  list(input: {
    organizationId: string;
    pharmacyLocationId?: string | undefined;
    medicineId?: string | undefined;
    includeInactive: boolean;
  }): Promise<readonly z.infer<typeof inventoryBatchSchema>[]>;
  find(
    organizationId: string,
    inventoryId: string,
  ): Promise<z.infer<typeof inventoryBatchSchema> | null>;
  create(input: {
    organizationId: string;
    actorId: string;
    value: z.output<typeof createInventoryBatchSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<z.infer<typeof inventoryBatchSchema>>;
  update(input: {
    organizationId: string;
    actorId: string;
    inventoryId: string;
    value: z.output<typeof updateInventoryBatchSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<z.infer<typeof inventoryBatchSchema>>;
  changeStock(input: {
    organizationId: string;
    actorId: string;
    inventoryId: string;
    value: z.output<typeof changeInventoryStockSchema>;
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }): Promise<z.infer<typeof inventoryBatchSchema>>;
  transactions(
    organizationId: string,
    inventoryId: string,
  ): Promise<readonly z.infer<typeof inventoryTransactionSchema>[]>;
  availability(input: {
    organizationId: string;
    medicineId?: string | undefined;
    pharmacyLocationId?: string | undefined;
    quantity: number;
  }): Promise<readonly z.infer<typeof inventoryAvailabilitySchema>[]>;
}

export class InventoryBatchNotFoundError extends RuntimeError {
  constructor() {
    super(
      "business_rule",
      "inventory_batch_not_found",
      "Inventory batch was not found",
      404,
      false,
    );
    this.name = "InventoryBatchNotFoundError";
  }
}

export class InventoryManagement {
  constructor(private readonly repository: InventoryManagementRepository) {}

  list(input: {
    organizationId: string;
    pharmacyLocationId?: string | undefined;
    medicineId?: string | undefined;
    includeInactive?: boolean | undefined;
  }) {
    return this.repository.list({
      ...input,
      includeInactive: input.includeInactive ?? false,
    });
  }

  async find(organizationId: string, inventoryId: string) {
    const batch = await this.repository.find(
      z.string().uuid().parse(organizationId),
      z.string().uuid().parse(inventoryId),
    );
    if (!batch) throw new InventoryBatchNotFoundError();
    return batch;
  }

  create(input: Omit<
    Parameters<InventoryManagementRepository["create"]>[0],
    "value"
  > & { value: z.input<typeof createInventoryBatchSchema> }) {
    return this.repository.create({
      ...input,
      value: createInventoryBatchSchema.parse(input.value),
    });
  }

  update(input: Omit<
    Parameters<InventoryManagementRepository["update"]>[0],
    "value"
  > & { value: z.input<typeof updateInventoryBatchSchema> }) {
    return this.repository.update({
      ...input,
      inventoryId: z.string().uuid().parse(input.inventoryId),
      value: updateInventoryBatchSchema.parse(input.value),
    });
  }

  changeStock(input: Omit<
    Parameters<InventoryManagementRepository["changeStock"]>[0],
    "value"
  > & { value: z.input<typeof changeInventoryStockSchema> }) {
    return this.repository.changeStock({
      ...input,
      inventoryId: z.string().uuid().parse(input.inventoryId),
      value: changeInventoryStockSchema.parse(input.value),
    });
  }

  transactions(organizationId: string, inventoryId: string) {
    return this.repository.transactions(
      z.string().uuid().parse(organizationId),
      z.string().uuid().parse(inventoryId),
    );
  }

  availability(input: {
    organizationId: string;
    medicineId?: string | undefined;
    pharmacyLocationId?: string | undefined;
    quantity?: number | undefined;
  }) {
    return this.repository.availability({
      ...input,
      quantity: z.number().int().positive().parse(input.quantity ?? 1),
    });
  }
}
