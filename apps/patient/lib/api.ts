export interface Mar{ id:string; medicineName:string; status:string; createdAt:string; pharmacyName?:string }
export interface Match{ inventoryId:string; pharmacyName:string; pharmacyLocality?:string; medicineName:string; distanceKm?:number; stockStatus:string }
export interface TimelineEvent{ id:number; event_type:string; from_state?:string; to_state?:string; correlation_id?:string; occurred_at:string; metadata:Record<string,unknown> }
export interface PatientNotification{ id:string; channel:string; template_key:string; status:string; correlation_id?:string; scheduled_for:string; sent_at?:string; delivered_at?:string; created_at:string }
const origin=process.env.MEDLINK_API_URL??"http://localhost:3000";
async function get<T>(path:string):Promise<T>{const response=await fetch(new URL(path,origin),{headers:{Accept:"application/json"},next:{revalidate:20}});if(!response.ok)throw new Error("API unavailable");return response.json() as Promise<T>}
export async function listMars(){return (await get<{data:Mar[]}>("/api/v1/mar")).data}
export async function getMar(id:string){return (await get<{data:Mar}>(`/api/v1/mar/${encodeURIComponent(id)}`)).data}
export async function getTimeline(id:string){return (await get<{data:TimelineEvent[]}>(`/api/v1/mar/${encodeURIComponent(id)}/timeline`)).data}
export async function listNotifications(){return (await get<{data:PatientNotification[]}>("/api/v1/notifications")).data}
export async function searchInventory(q:string){return (await get<{data:Match[]}>(`/api/v1/inventory?q=${encodeURIComponent(q)}`)).data}
