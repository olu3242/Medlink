export type AgentKind="prescription_reader"|"medicine_matcher"|"inventory_finder"|"clinical_review_assistant"|"pricing_advisor"|"education_assistant";
export interface AgentRequest<T>{readonly requestId:string;readonly tenantId:string;readonly marId:string;readonly kind:AgentKind;readonly input:T;}
export interface AgentRecommendation<T>{readonly kind:"recommendation";readonly data:T;readonly confidence:number;readonly requiresHumanReview:true;readonly mayTransitionMar:false;readonly mayMakeClinicalDecision:false;}
export interface AgentEscalation{readonly kind:"escalation";readonly reason:string;readonly confidence:number;readonly requiresHumanReview:true;readonly mayTransitionMar:false;readonly mayMakeClinicalDecision:false;}
export type AgentOutput<T>=AgentRecommendation<T>|AgentEscalation;
export interface TypedAgent<I,O>{readonly kind:AgentKind;run(input:I):Promise<{readonly data:O;readonly confidence:number}>;}
export interface AgentAuditSink{append(event:{readonly requestId:string;readonly tenantId:string;readonly marId:string;readonly agent:AgentKind;readonly confidence:number;readonly outcome:"recommendation"|"escalation";readonly occurredAt:Date}):Promise<void>;}
export interface ConfidencePolicy{threshold(tenantId:string,agent:AgentKind):Promise<number>;}
export class AgentOrchestrator{
 constructor(private readonly audit:AgentAuditSink,private readonly policy:ConfidencePolicy,private readonly now:()=>Date){}
 async execute<I,O>(request:AgentRequest<I>,agent:TypedAgent<I,O>):Promise<AgentOutput<O>>{
  if(agent.kind!==request.kind)throw new Error("Agent kind mismatch");
  const result=await agent.run(request.input);const confidence=Math.max(0,Math.min(1,result.confidence));const threshold=await this.policy.threshold(request.tenantId,request.kind);
  const output:AgentOutput<O>=confidence<threshold?{kind:"escalation",reason:"Confidence below configured threshold",confidence,requiresHumanReview:true,mayTransitionMar:false,mayMakeClinicalDecision:false}:{kind:"recommendation",data:result.data,confidence,requiresHumanReview:true,mayTransitionMar:false,mayMakeClinicalDecision:false};
  await this.audit.append({requestId:request.requestId,tenantId:request.tenantId,marId:request.marId,agent:request.kind,confidence,outcome:output.kind,occurredAt:this.now()});return output;
 }
}
