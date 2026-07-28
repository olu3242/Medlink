export interface Stock{inventoryId:string;medicineName:string;strength:string;quantity:number;updatedAt:string}
export interface Reservation{id:string;medicineName:string;patientReference:string;status:string;expiresAt:string}
const origin=process.env.MEDLINK_API_URL??"http://localhost:3000";async function list<T>(path:string){const r=await fetch(new URL(path,origin),{headers:{Accept:"application/json"},cache:"no-store"});if(!r.ok)throw new Error();return(await r.json()as{data:T[]}).data}
export const inventory=()=>list<Stock>("/api/v1/inventory");export const reservations=()=>list<Reservation>("/api/v1/reservations");
