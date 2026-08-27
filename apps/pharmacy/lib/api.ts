import { cookies, headers } from "next/headers";
import { resolveServerOrigin } from "@medlink/platform";

export interface Stock{inventoryId:string;medicineName:string;strength:string;quantity:number;updatedAt:string}
export interface Reservation{id:string;medicineName:string;patientId:string;status:string;expiresAt:string;paymentRequired:boolean;paymentStatus:string|null}
const apiOrigin=()=>resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN","MEDLINK_API_URL"],"http://localhost:3000","pharmacy API calls");async function list<T>(path:string){const[incoming,cookieStore]=await Promise.all([headers(),cookies()]);const forwarded=new Headers({Accept:"application/json"});const cookieHeader=cookieStore.getAll().map(({name,value})=>`${name}=${value}`).join("; ");if(cookieHeader)forwarded.set("cookie",cookieHeader);for(const name of["authorization","x-medlink-tenant-id"]){const value=incoming.get(name);if(value)forwarded.set(name,value)}const r=await fetch(new URL(path,apiOrigin()),{headers:forwarded,cache:"no-store"});if(!r.ok)throw new Error();return(await r.json()as{data:T[]}).data}
export const inventory=()=>list<Stock>("/pharmacy/api/v1/inventory");export const reservations=()=>list<Reservation>("/pharmacy/api/v1/reservations");
