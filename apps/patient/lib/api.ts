export interface Mar{ id:string; medicineName:string; status:string; createdAt:string; pharmacyName?:string }
export interface Match{ inventoryId:string; pharmacyName:string; pharmacyLocality?:string; medicineName:string; stockStatus:string }
const origin=process.env.MEDLINK_API_URL??"http://localhost:3000";
async function get<T>(path:string):Promise<T>{const response=await fetch(new URL(path,origin),{headers:{Accept:"application/json"},next:{revalidate:20}});if(!response.ok)throw new Error("API unavailable");return response.json() as Promise<T>}
export async function listMars(){return (await get<{data:Mar[]}>("/api/v1/mar")).data}
export async function getMar(id:string){return (await get<{data:Mar}>(`/api/v1/mar/${encodeURIComponent(id)}`)).data}
export async function searchInventory(q:string){return (await get<{data:Match[]}>(`/api/v1/inventory?q=${encodeURIComponent(q)}`)).data}
