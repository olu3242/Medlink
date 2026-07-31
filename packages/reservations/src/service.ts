import{InvalidReservationError,ReservationNotFoundError}from"./errors";import type{Reservation}from"./models";import type{ReservationClock,ReservationIds,ReservationInventory,ReservationRepository}from"./ports";
export class ReservationService{
 constructor(private readonly repo:ReservationRepository,private readonly inventory:ReservationInventory,private readonly ids:ReservationIds,private readonly clock:ReservationClock){}
 async create(input:{tenantId:string;marId:string;patientId:string;pharmacyId:string;inventoryItemId:string;quantity:number;expiresAt:Date;idempotencyKey:string}):Promise<Reservation>{
  const prior=await this.repo.findByIdempotencyKey(input.idempotencyKey);if(prior)return prior;
  if(!Number.isInteger(input.quantity)||input.quantity<=0||input.expiresAt<=this.clock.now())throw new InvalidReservationError();
  const id=this.ids.next();const lock=await this.inventory.lock({tenantId:input.tenantId,itemId:input.inventoryItemId,reservationId:id,quantity:input.quantity,expiresAt:input.expiresAt,idempotencyKey:`reservation:${input.idempotencyKey}`});
  try{return await this.repo.create({...input,id,inventoryLockId:lock.id,status:"pending",createdAt:this.clock.now()});}
  catch(error){await this.inventory.release(input.tenantId,lock.id);throw error;}
 }
 async expire(tenantId:string,id:string):Promise<Reservation>{
  const current=await this.repo.findById(tenantId,id);if(!current)throw new ReservationNotFoundError();
  if(current.status==="expired"){await this.inventory.release(tenantId,current.inventoryLockId);return current;}
  if(!["pending","confirmed","ready"].includes(current.status)||current.expiresAt>this.clock.now())return current;
  const expired=await this.repo.markExpiredAtomically(tenantId,id,this.clock.now());if(!expired)return current;
  await this.inventory.release(tenantId,expired.inventoryLockId);return expired;
 }
}
