export interface Overview{displayName:string;activeRequests:number;readyForPickup:number;adherencePercent:number;unreadNotifications:number;recentRequests:{id:string;medicine:string;status:string}[]}
export interface Notice{id:string;title:string;body:string;read:boolean;createdAt:string}
export interface Payment{id:string;description:string;amount:number;currency:string;status:string;createdAt:string}
export interface Adherence{medicineId:string;medicineName:string;periodDays:number;taken:number;scheduled:number;nextDoseAt?:string}
const origin=process.env.MEDLINK_API_URL??"http://localhost:3000";async function get<T>(path:string):Promise<T>{const r=await fetch(new URL(path,origin),{headers:{Accept:"application/json"},cache:"no-store"});if(!r.ok)throw new Error("Dashboard service unavailable");return(await r.json()as{data:T}).data}
export const overview=()=>get<Overview>("/api/v1/dashboard");export const notifications=()=>get<Notice[]>("/api/v1/notifications");export const payments=()=>get<Payment[]>("/api/v1/payments");export const adherence=()=>get<Adherence[]>("/api/v1/adherence");
