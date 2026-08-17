export interface WorkflowInstance {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly status: "running" | "completed" | "failed";
  readonly completedSteps: readonly string[];
  readonly context: Readonly<Record<string, unknown>>;
}

export interface WorkflowStore {
  // Scoped by tenantId, not just the idempotency key: two different
  // tenants using the same key string (plausible if a key is derived from
  // an external message id, for instance) must never resolve to each
  // other's workflow instance. A persisted, genuinely multi-tenant store
  // needs both; an in-memory single-run test fake can ignore the first
  // argument, but the port itself must not make that assumption for it.
  findByKey(tenantId: string, key: string): Promise<WorkflowInstance | null>;
  create(input: {
    tenantId: string;
    type: string;
    idempotencyKey: string;
    context?: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInstance>;
  // contextPatch is merged into the instance's context alongside marking the
  // step complete, in one call, so a step's output (e.g. WF-005's search
  // results) is durably recorded atomically with the step advancing -- not
  // a separate write a crash between the two could leave inconsistent.
  markStep(
    id: string,
    step: string,
    contextPatch: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowInstance>;
  complete(id: string): Promise<WorkflowInstance>;
}

export interface WorkflowStep {
  readonly name: string;
  // A step may return a context patch to carry its output to later steps
  // and to the caller (e.g. search results, a resolved medicine id).
  // Returning void is still valid for a step with no output of its own.
  execute(instance: WorkflowInstance): Promise<Readonly<Record<string, unknown>> | void>;
}

export class WorkflowSafetyError extends Error {
  readonly code = "workflow_safety_limit_exceeded";

  constructor(message: string) {
    super(message);
    this.name = "WorkflowSafetyError";
  }
}

export class WorkflowService {
  constructor(
    private readonly store: WorkflowStore,
    private readonly maximumSteps = 32,
  ) {}

  async run(input: {
    tenantId: string;
    type: string;
    idempotencyKey: string;
    steps: readonly WorkflowStep[];
    context?: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowInstance> {
    if (input.steps.length > this.maximumSteps) {
      throw new WorkflowSafetyError("Workflow exceeds the maximum agent step count");
    }
    const names = input.steps.map((step) => step.name);
    if (new Set(names).size !== names.length) {
      throw new WorkflowSafetyError("Workflow contains a repeated step name");
    }
    let instance =
      (await this.store.findByKey(input.tenantId, input.idempotencyKey)) ??
      (await this.store.create(input));
    if (instance.status === "completed") return instance;
    for (const step of input.steps) {
      if (instance.completedSteps.includes(step.name)) continue;
      const contextPatch = (await step.execute(instance)) ?? {};
      instance = await this.store.markStep(instance.id, step.name, contextPatch);
    }
    return this.store.complete(instance.id);
  }
}

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
