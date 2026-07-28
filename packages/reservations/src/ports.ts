import type{Reservation}from"./models";
export interface ReservationRepository{findByIdempotencyKey(key:string):Promise<Reservation|null>;create(input:Reservation&{readonly idempotencyKey:string}):Promise<Reservation>;findById(tenantId:string,id:string):Promise<Reservation|null>;markExpiredAtomically(tenantId:string,id:string,now:Date):Promise<Reservation|null>;}
export interface ReservationInventory{lock(input:{tenantId:string;itemId:string;reservationId:string;quantity:number;expiresAt:Date;idempotencyKey:string}):Promise<{readonly id:string}>;release(tenantId:string,lockId:string):Promise<unknown>;}
export interface ReservationIds{next():string;} export interface ReservationClock{now():Date;}
