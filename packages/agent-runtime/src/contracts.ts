export interface AgentContext {
  readonly tenantId: string;
  readonly patientId?: string | undefined;
  readonly prescriptionId?: string | undefined;
  readonly pharmacistId?: string | undefined;
  readonly pharmacyId?: string | undefined;
  readonly sessionId?: string | undefined;
}

export interface AgentTask<TInput, TOutput> {
  readonly id: string;
  readonly engine: string;
  readonly capability: string;
  readonly action: string;
  readonly actor: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly context: AgentContext;
  readonly input: TInput;
  execute(): Promise<TOutput>;
}

export interface AgentApproval {
  readonly status: "pending_human_review";
  readonly approver: "pharmacist";
  readonly reason: string;
  readonly taskId: string;
  readonly correlationId: string;
}

export type AgentTaskResult<TOutput> =
  | { readonly status: "completed"; readonly output: TOutput }
  | AgentApproval;

export type AgentTaskStatus =
  | "started"
  | "completed"
  | "failed"
  | "policy_denied"
  | "pending_human_review";

export interface AgentTaskTelemetry {
  readonly taskId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly engine: string;
  readonly capability: string;
  readonly action: string;
  readonly status: AgentTaskStatus;
  readonly durationMs: number;
  readonly errorCode?: string | undefined;
}

export interface AgentTaskObserver {
  record(event: AgentTaskTelemetry): void | Promise<void>;
}

export type AgentPolicyDecision =
  | { readonly status: "allowed" }
  | { readonly status: "blocked"; readonly reason: string }
  | {
      readonly status: "requires_human_review";
      readonly approver: "pharmacist";
      readonly reason: string;
    };

export interface AgentPolicy {
  evaluate(
    task: Pick<
      AgentTask<unknown, unknown>,
      "action" | "actor" | "capability" | "context" | "engine" | "tenantId"
    >,
  ): AgentPolicyDecision;
}
