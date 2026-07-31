import type {Coordinates,Pharmacy} from "./models";
export interface PharmacyReader { findNear(input:{tenantId:string;origin:Coordinates;radiusKm:number}):Promise<readonly Pharmacy[]>; }
export interface PharmacyStockReader { confidence(pharmacyId:string,medicineId:string):Promise<number>; }
