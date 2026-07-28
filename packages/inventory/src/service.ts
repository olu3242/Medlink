import { InsufficientInventoryError, InvalidInventoryQuantityError } from "./errors";
import type { InventoryAvailability, InventoryLock } from "./models";
import type { InventoryClock, InventoryRepository } from "./ports";
export class InventoryService {
  constructor(private readonly repository:InventoryRepository,private readonly clock:InventoryClock){}
  async availability(tenantId:string,itemId:string):Promise<InventoryAvailability>{
    const item=await this.repository.findItem(tenantId,itemId);
    const available=item && (!item.expiresAt || item.expiresAt>this.clock.now())?Math.max(0,item.onHand-item.reserved):0;
    return {itemId,available,inStock:available>0};
  }
  async lock(input:{tenantId:string;itemId:string;reservationId:string;quantity:number;expiresAt:Date;idempotencyKey:string}):Promise<InventoryLock>{
    if(!Number.isInteger(input.quantity)||input.quantity<=0) throw new InvalidInventoryQuantityError();
    const prior=await this.repository.findLockByIdempotencyKey(input.idempotencyKey); if(prior)return prior;
    if(input.expiresAt<=this.clock.now()) throw new InsufficientInventoryError();
    const lock=await this.repository.acquireLockAtomically(input);
    if(!lock)throw new InsufficientInventoryError(); return lock;
  }
  async release(tenantId:string,lockId:string):Promise<InventoryLock|null>{return this.repository.releaseLockAtomically(tenantId,lockId);}
}
