export type NotificationChannelName="email"|"sms"|"push";
export interface Notification{readonly id:string;readonly tenantId:string;readonly recipientId:string;readonly template:string;readonly variables:Readonly<Record<string,string>>;readonly channel:NotificationChannelName;}
export interface NotificationChannel{readonly name:NotificationChannelName;send(message:Notification):Promise<{readonly providerId:string}>;}
export interface NotificationStore{find(key:string):Promise<{readonly providerId:string}|null>;record(key:string,result:{readonly providerId:string}):Promise<void>;}
export class NotificationService{
 constructor(private readonly channels:readonly NotificationChannel[],private readonly store:NotificationStore){}
 async send(message:Notification,idempotencyKey:string):Promise<{readonly providerId:string}>{
  const prior=await this.store.find(idempotencyKey);if(prior)return prior;
  const channel=this.channels.find(x=>x.name===message.channel);if(!channel)throw new Error(`Unsupported notification channel '${message.channel}'`);
  const result=await channel.send(message);await this.store.record(idempotencyKey,result);return result;
 }
}
