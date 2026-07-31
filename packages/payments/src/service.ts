export type PaymentStatus="pending"|"authorized"|"captured"|"failed"|"partially_refunded"|"refunded";
export interface Money{readonly amountMinor:number;readonly currency:string;}
export interface Payment{readonly id:string;readonly tenantId:string;readonly reservationId:string;readonly providerReference:string;readonly total:Money;readonly refundedMinor:number;readonly status:PaymentStatus;}
export interface PaymentProvider{authorize(input:{amount:Money;paymentMethodToken:string;idempotencyKey:string}):Promise<{providerReference:string}>;refund(input:{providerReference:string;amount:Money;idempotencyKey:string}):Promise<void>;}
export interface PaymentRepository{findByKey(key:string):Promise<Payment|null>;save(payment:Payment,key:string):Promise<Payment>;updateRefund(id:string,amountMinor:number,status:PaymentStatus):Promise<Payment>;}
export class PaymentError extends Error{constructor(message:string,readonly code:string){super(message);this.name=new.target.name;}}
export class PaymentService{
 constructor(private readonly provider:PaymentProvider,private readonly repo:PaymentRepository,private readonly id:()=>string){}
 async authorize(input:{tenantId:string;reservationId:string;amount:Money;paymentMethodToken:string;idempotencyKey:string}):Promise<Payment>{
  if(!Number.isInteger(input.amount.amountMinor)||input.amount.amountMinor<=0)throw new PaymentError("Invalid amount","invalid_amount");
  const prior=await this.repo.findByKey(input.idempotencyKey);if(prior)return prior;
  const result=await this.provider.authorize({amount:input.amount,paymentMethodToken:input.paymentMethodToken,idempotencyKey:input.idempotencyKey});
  return this.repo.save({id:this.id(),tenantId:input.tenantId,reservationId:input.reservationId,providerReference:result.providerReference,total:input.amount,refundedMinor:0,status:"authorized"},input.idempotencyKey);
 }
 async refund(payment:Payment,amountMinor:number,key:string):Promise<Payment>{
  if(!Number.isInteger(amountMinor)||amountMinor<=0||payment.refundedMinor+amountMinor>payment.total.amountMinor)throw new PaymentError("Invalid refund amount","invalid_refund");
  await this.provider.refund({providerReference:payment.providerReference,amount:{amountMinor,currency:payment.total.currency},idempotencyKey:key});
  const total=payment.refundedMinor+amountMinor;return this.repo.updateRefund(payment.id,total,total===payment.total.amountMinor?"refunded":"partially_refunded");
 }
}
