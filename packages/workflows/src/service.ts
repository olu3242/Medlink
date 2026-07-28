export interface WorkflowInstance{readonly id:string;readonly tenantId:string;readonly type:string;readonly status:"running"|"completed"|"failed";readonly completedSteps:readonly string[];}
export interface WorkflowStore{findByKey(key:string):Promise<WorkflowInstance|null>;create(input:{tenantId:string;type:string;idempotencyKey:string}):Promise<WorkflowInstance>;markStep(id:string,step:string):Promise<WorkflowInstance>;complete(id:string):Promise<WorkflowInstance>;}
export interface WorkflowStep{readonly name:string;execute(instance:WorkflowInstance):Promise<void>;}
export class WorkflowService{constructor(private readonly store:WorkflowStore){}
 async run(input:{tenantId:string;type:string;idempotencyKey:string;steps:readonly WorkflowStep[]}):Promise<WorkflowInstance>{let instance=await this.store.findByKey(input.idempotencyKey)??await this.store.create(input);if(instance.status==="completed")return instance;for(const step of input.steps){if(instance.completedSteps.includes(step.name))continue;await step.execute(instance);instance=await this.store.markStep(instance.id,step.name);}return this.store.complete(instance.id);}}

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
