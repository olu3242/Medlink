export interface InventoryBatch {
  id: string;
  organizationId: string;
  pharmacyLocationId: string;
  pharmacyName: string;
  medicineId: string;
  brandName: string;
  genericName: string;
  strength: string;
  batchNumber: string;
  expiresOn: string;
  supplier: string | null;
  receivedOn: string;
  quantityOnHand: number;
  quantityReserved: number;
  availableQuantity: number;
  unit: string;
  unitPriceMinor: number | null;
  currencyCode: string | null;
  lowStockThreshold: number;
  recordStatus: "available" | "quarantined" | "recalled" | "depleted" | "expired";
  availabilityState: "in_stock" | "low_stock" | "reserved" | "out_of_stock" | "expired" | "inactive";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  batchId: string;
  kind: "receive" | "dispense" | "reserve" | "release" | "adjustment" | "expiry" | "return";
  quantityDelta: number;
  reservedDelta: number;
  quantityOnHandBefore: number;
  quantityOnHandAfter: number;
  quantityReservedBefore: number;
  quantityReservedAfter: number;
  reason: string;
  actorId: string | null;
  occurredAt: string;
}
