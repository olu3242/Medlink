export interface WorkflowInstance {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly status: "running" | "completed" | "failed";
  readonly completedSteps: readonly string[];
  readonly context: Readonly<Record<string, unknown>>;
}

export interface WorkflowStore {
  findByKey(key: string): Promise<WorkflowInstance | null>;
  create(input: { tenantId: string; type: string; idempotencyKey: string }): Promise<WorkflowInstance>;
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

export class WorkflowService {
  constructor(private readonly store: WorkflowStore) {}

  async run(input: {
    tenantId: string;
    type: string;
    idempotencyKey: string;
    steps: readonly WorkflowStep[];
  }): Promise<WorkflowInstance> {
    let instance = (await this.store.findByKey(input.idempotencyKey)) ?? (await this.store.create(input));
    if (instance.status === "completed") return instance;
    for (const step of input.steps) {
      if (instance.completedSteps.includes(step.name)) continue;
      const contextPatch = (await step.execute(instance)) ?? {};
      instance = await this.store.markStep(instance.id, step.name, contextPatch);
    }
    return this.store.complete(instance.id);
  }
}

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
