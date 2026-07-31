export interface Client{id:string;name:string;keyPrefix:string;scopes:string[];status:string;createdAt:string;lastUsedAt?:string}
export interface Webhook{id:string;url:string;events:string[];status:string;createdAt:string}
export interface Delivery{id:string;webhookId:string;event:string;status:"delivered"|"pending"|"failed";statusCode?:number;attempts:number;createdAt:string}
export interface Integration{id:string;category:"FHIR"|"HL7"|"HMO"|"Government"|"Manufacturer"|"Distributor";name:string;status:"healthy"|"degraded"|"offline"|"setup";lastSyncAt?:string;message?:string}
const origin=process.env.MEDLINK_API_URL??"http://localhost:3000";async function get<T>(path:string):Promise<T>{const r=await fetch(new URL(path,origin),{headers:{Accept:"application/json"},cache:"no-store"});if(!r.ok)throw new Error();return(await r.json()as{data:T}).data}
export const clients=()=>get<Client[]>("/api/v1/developer/clients");export const webhooks=()=>get<Webhook[]>("/api/v1/developer/webhooks");export const deliveries=()=>get<Delivery[]>("/api/v1/developer/webhook-deliveries");export const integrations=()=>get<Integration[]>("/api/v1/integrations");
