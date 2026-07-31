export interface InventoryItem {
  readonly id:string; readonly tenantId:string; readonly pharmacyId:string;
  readonly medicineId:string; readonly onHand:number; readonly reserved:number;
  readonly version:number; readonly expiresAt?:Date;
}
export interface InventoryAvailability { readonly itemId:string; readonly available:number; readonly inStock:boolean; }
export interface InventoryLock {
  readonly id:string; readonly tenantId:string; readonly itemId:string; readonly reservationId:string;
  readonly quantity:number; readonly status:"active"|"released"|"consumed"; readonly expiresAt:Date;
}
