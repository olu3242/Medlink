export interface Mar{ id:string; medicineId?:string; medicineName:string; status:string; createdAt:string; pharmacyName?:string }
export interface Match{ inventoryId:string; pharmacyLocationId:string; pharmacyName:string; pharmacyLocality?:string; medicineName:string; medicineId?:string; distanceKm?:number; stockStatus:string; relationship?:"exact"|"generic_related"; reservationEligible?:boolean; pharmacistReviewRequired?:boolean; unitPriceMinor?:number|null; currencyCode?:string|null; priceStatus?:"AVAILABLE"|"PRICE_NOT_AVAILABLE" }
export interface TimelineEvent{ id:number; event_type:string; from_state?:string; to_state?:string; correlation_id?:string; occurred_at:string; metadata:Record<string,unknown> }
export interface PatientNotification{ id:string; channel:string; template_key:string; status:string; correlation_id?:string; scheduled_for:string; sent_at?:string; delivered_at?:string; created_at:string }
// pickup_code_hash is the only signal available (from the raw reservations
// row) that a pickup credential has already been issued for this
// reservation -- never the plaintext, which no server ever stores.
export interface PatientReservation{ id:string; status:string; payment_required:boolean; pickup_code_hash:string|null; expires_at:string; created_at:string; confirmed_at?:string|null; payments?:Array<{id:string;status:string;amount_minor:number;currency_code:string;reconciliation_required:boolean;created_at:string}> }
import { cookies, headers } from "next/headers";
import { resolveServerOrigin } from "@medlink/platform";
const apiOrigin=()=>resolveServerOrigin(["MEDLINK_PUBLIC_ORIGIN","MEDLINK_API_URL"],"http://localhost:3000","patient API calls");
// Server components call this app's own API route via absolute-URL
// fetch, which -- unlike a browser's same-origin relative fetch -- never
// automatically carries the incoming request's cookies. Forwarding them
// explicitly (matching apps/pharmacist/lib/api.ts's already-correct
// pattern) is what makes a logged-in patient's session actually reach
// the route instead of 401ing silently. cache:"no-store" replaces the
// prior revalidate:20 -- a response that now varies per session cookie
// must never be shared across users via Next's fetch cache.
async function get<T>(path:string):Promise<T>{
  const [incoming, cookieStore] = await Promise.all([headers(), cookies()]);
  const forwarded = new Headers({ Accept: "application/json" });
  const cookieHeader = cookieStore.getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (cookieHeader) forwarded.set("cookie", cookieHeader);
  for (const name of ["authorization", "x-medlink-tenant-id"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const response = await fetch(new URL(path,apiOrigin()),{headers:forwarded,cache:"no-store"});
  if(!response.ok)throw new Error("API unavailable");
  return response.json() as Promise<T>;
}
export async function listMars(){return (await get<{data:Mar[]}>("/patient/api/v1/mar")).data}
export async function getMar(id:string){return (await get<{data:Mar}>(`/patient/api/v1/mar/${encodeURIComponent(id)}`)).data}
export async function getTimeline(id:string){return (await get<{data:TimelineEvent[]}>(`/patient/api/v1/mar/${encodeURIComponent(id)}/timeline`)).data}
export async function listNotifications(){return (await get<{data:PatientNotification[]}>("/patient/api/v1/notifications")).data}
export async function searchInventory(q:string){return (await get<{data:Match[]}>(`/patient/api/v1/inventory?q=${encodeURIComponent(q)}`)).data}
export async function listReservations(){return (await get<{data:PatientReservation[]}>("/patient/api/v1/reservations")).data}
