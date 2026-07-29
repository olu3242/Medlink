export interface WorkflowInstance{readonly id:string;readonly tenantId:string;readonly type:string;readonly status:"running"|"waiting"|"completed"|"failed";readonly completedSteps:readonly string[];}
export interface WorkflowStore{findByKey(key:string):Promise<WorkflowInstance|null>;create(input:{tenantId:string;type:string;idempotencyKey:string}):Promise<WorkflowInstance>;markStep(id:string,step:string):Promise<WorkflowInstance>;complete(id:string):Promise<WorkflowInstance>;}
export interface WorkflowStep{readonly name:string;execute(instance:WorkflowInstance):Promise<void>;}
export class WorkflowService{constructor(private readonly store:WorkflowStore){}
 async run(input:{tenantId:string;type:string;idempotencyKey:string;steps:readonly WorkflowStep[]}):Promise<WorkflowInstance>{let instance=await this.store.findByKey(input.idempotencyKey)??await this.store.create(input);if(instance.status==="completed")return instance;for(const step of input.steps){if(instance.completedSteps.includes(step.name))continue;await step.execute(instance);instance=await this.store.markStep(instance.id,step.name);}return this.store.complete(instance.id);}}

export interface OutboxEvent{readonly id:string;readonly tenantId:string;readonly type:string;readonly aggregateId:string;readonly payload:Readonly<Record<string,unknown>>;readonly attempts:number;}
export interface OutboxStore{claim(worker:string,limit:number):Promise<readonly OutboxEvent[]>;published(id:string):Promise<void>;retry(id:string,availableAt:Date,errorCode:string):Promise<void>;deadLetter(id:string,errorCode:string):Promise<void>;}
export interface EventConsumer{readonly eventType:string;handle(event:OutboxEvent):Promise<void>;}
export class OutboxDispatcher{constructor(private readonly store:OutboxStore,private readonly consumers:readonly EventConsumer[],private readonly now:()=>Date){}
 async dispatch(worker:string,limit=50){for(const event of await this.store.claim(worker,limit)){const consumer=this.consumers.find(x=>x.eventType===event.type);if(!consumer){await this.store.deadLetter(event.id,"consumer_missing");continue;}try{await consumer.handle(event);await this.store.published(event.id);}catch{if(event.attempts>=4)await this.store.deadLetter(event.id,"retry_exhausted");else await this.store.retry(event.id,new Date(this.now().getTime()+2**event.attempts*1000),"consumer_failed");}}}}

export const canonicalWorkflows = [
  ["WF-001", "Patient Registration"],
  ["WF-002", "Authentication"],
  ["WF-003", "Prescription Upload"],
  ["WF-004", "Prescription Parsing"],
  ["WF-005", "Medicine Search"],
  ["WF-006", "Medication Access Request"],
  ["WF-007", "Clinical Review"],
  ["WF-008", "Inventory Discovery"],
  ["WF-009", "Reservation"],
  ["WF-010", "Pickup"],
  ["WF-011", "Delivery"],
  ["WF-012", "Medication Reminder"],
  ["WF-013", "Consultation"],
  ["WF-014", "Refill"],
  ["WF-015", "Workflow Completion"],
] as const;

export type CanonicalWorkflowId = (typeof canonicalWorkflows)[number][0];
