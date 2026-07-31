export type PartnerKind="hmo"|"government"|"manufacturer"|"distributor";
export interface IntegrationEnvelope<T>{readonly tenantId:string;readonly partnerId:string;readonly correlationId:string;readonly payload:T;}
export interface FhirAdapter<TIn,TOut>{parse(resource:unknown):TIn;serialize(value:TOut):unknown;}
export interface Hl7Adapter<T>{parse(message:string):T;serialize(value:T):string;}
export interface PartnerConnector<I,O>{readonly kind:PartnerKind;execute(input:IntegrationEnvelope<I>):Promise<O>;}
export interface SignatureVerifier{verify(input:{body:Uint8Array;signature:string;timestamp:string}):Promise<boolean>;}
export interface ReplayStore{claimOnce(key:string,expiresAt:Date):Promise<boolean>;}
export class WebhookRejectedError extends Error{constructor(readonly code:"invalid_signature"|"replayed_webhook"|"stale_webhook"){super(code);this.name=new.target.name;}}
export class WebhookGuard{
 constructor(private readonly verifier:SignatureVerifier,private readonly replay:ReplayStore,private readonly now:()=>Date,private readonly toleranceMs=300_000){}
 async verify(input:{body:Uint8Array;signature:string;timestamp:string;eventId:string}):Promise<void>{
  const timestamp=new Date(input.timestamp);if(!Number.isFinite(timestamp.valueOf())||Math.abs(this.now().valueOf()-timestamp.valueOf())>this.toleranceMs)throw new WebhookRejectedError("stale_webhook");
  if(!await this.verifier.verify(input))throw new WebhookRejectedError("invalid_signature");
  if(!await this.replay.claimOnce(input.eventId,new Date(this.now().valueOf()+this.toleranceMs)))throw new WebhookRejectedError("replayed_webhook");
 }
}
