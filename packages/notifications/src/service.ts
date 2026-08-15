export type NotificationChannelName="email"|"sms"|"push"|"whatsapp";
export interface Notification{readonly id:string;readonly tenantId:string;readonly recipientId:string;readonly template:string;readonly variables:Readonly<Record<string,string>>;readonly channel:NotificationChannelName;}
export interface NotificationChannel{readonly name:NotificationChannelName;send(message:Notification):Promise<{readonly providerId:string}>;}
// Both find() and record() take the original message, not just the key --
// a durable, multi-tenant store needs message.tenantId to scope its lookup
// and insert correctly (an idempotency key is only unique per tenant, the
// same way every other idempotency key in this codebase is scoped), and
// record() additionally needs recipientId/template/variables/channel to
// persist a real row (e.g. for a patient to see their own notification
// history) -- neither is reconstructable from {providerId} alone.
export interface NotificationStore{find(key:string,message:Notification):Promise<{readonly providerId:string}|null>;record(key:string,message:Notification,result:{readonly providerId:string}):Promise<void>;}
export class NotificationError extends Error{constructor(message:string,readonly code:string){super(message);this.name=new.target.name;}}
export class NotificationService{
 constructor(private readonly channels:readonly NotificationChannel[],private readonly store:NotificationStore){}
 async send(message:Notification,idempotencyKey:string):Promise<{readonly providerId:string}>{
  const prior=await this.store.find(idempotencyKey,message);if(prior)return prior;
  const channel=this.channels.find(x=>x.name===message.channel);if(!channel)throw new Error(`Unsupported notification channel '${message.channel}'`);
  const result=await channel.send(message);await this.store.record(idempotencyKey,message,result);return result;
 }
}
