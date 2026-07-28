export interface AuditRecord{readonly id:string;readonly tenantId:string;readonly actorId:string;readonly action:string;readonly subjectType:string;readonly subjectId:string;readonly occurredAt:Date;readonly metadata:Readonly<Record<string,string>>;}
export interface ConsentRecord{readonly id:string;readonly tenantId:string;readonly patientId:string;readonly purpose:string;readonly status:"granted"|"withdrawn";readonly occurredAt:Date;readonly supersedesId?:string;}
export interface Incident{readonly id:string;readonly tenantId:string;readonly severity:"low"|"medium"|"high"|"critical";readonly summary:string;readonly status:"open"|"contained"|"resolved";readonly occurredAt:Date;}
export interface GovernanceLedger{appendAudit(record:AuditRecord):Promise<void>;appendConsent(record:ConsentRecord):Promise<void>;appendIncident(record:Incident):Promise<void>;}
export class GovernanceService{constructor(private readonly ledger:GovernanceLedger,private readonly id:()=>string,private readonly now:()=>Date){}
 audit(input:Omit<AuditRecord,"id"|"occurredAt">):Promise<void>{return this.ledger.appendAudit({...input,id:this.id(),occurredAt:this.now()});}
 consent(input:Omit<ConsentRecord,"id"|"occurredAt">):Promise<void>{return this.ledger.appendConsent({...input,id:this.id(),occurredAt:this.now()});}
 incident(input:Omit<Incident,"id"|"occurredAt">):Promise<void>{return this.ledger.appendIncident({...input,id:this.id(),occurredAt:this.now()});}}
