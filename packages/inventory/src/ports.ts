import type { InventoryItem, InventoryLock } from "./models";
export interface InventoryRepository {
  findItem(tenantId:string,itemId:string):Promise<InventoryItem|null>;
  acquireLockAtomically(input:{tenantId:string;itemId:string;reservationId:string;quantity:number;expiresAt:Date;idempotencyKey:string}):Promise<InventoryLock|null>;
  releaseLockAtomically(tenantId:string,lockId:string):Promise<InventoryLock|null>;
  findLockByIdempotencyKey(key:string):Promise<InventoryLock|null>;
}
export interface InventoryClock { now():Date; }
