import type {
  AgentPolicy,
  AgentTask,
  AgentTaskObserver,
  AgentTaskResult,
  AgentTaskStatus,
} from "./contracts";

export class AgentPolicyDeniedError extends Error {
  readonly code = "agent_policy_denied";

  constructor(readonly reason: string) {
    super("The task is not permitted by MVP policy");
    this.name = "AgentPolicyDeniedError";
  }
}

export class AgentTaskExecutor {
  constructor(
    private readonly policy: AgentPolicy,
    private readonly observer: AgentTaskObserver,
    private readonly now: () => number = () => performance.now(),
  ) {}

  private async record<TInput, TOutput>(
    task: AgentTask<TInput, TOutput>,
    status: AgentTaskStatus,
    startedAt: number,
    errorCode?: string,
  ): Promise<void> {
    await this.observer.record({
      taskId: task.id,
      correlationId: task.correlationId,
      tenantId: task.tenantId,
      engine: task.engine,
      capability: task.capability,
      action: task.action,
      actor: task.actor,
      agentId: task.agentId ?? task.engine,
      agentVersion: task.agentVersion ?? "1.0.0",
      persona: task.persona ?? "system",
      requiresHumanApproval: task.requiresHumanApproval ?? false,
      context: task.context,
      status,
      durationMs: Math.max(0, this.now() - startedAt),
      ...(errorCode ? { errorCode } : {}),
    });
  }

  async execute<TInput, TOutput>(
    task: AgentTask<TInput, TOutput>,
  ): Promise<AgentTaskResult<TOutput>> {
    const startedAt = this.now();
    const decision = this.policy.evaluate(task);
    if (decision.status === "blocked") {
      await this.record(task, "policy_denied", startedAt, "agent_policy_denied");
      throw new AgentPolicyDeniedError(decision.reason);
    }
    if (decision.status === "requires_human_review") {
      await this.record(task, "pending_human_review", startedAt);
      return {
        status: "pending_human_review",
        approver: decision.approver,
        reason: decision.reason,
        taskId: task.id,
        correlationId: task.correlationId,
      };
    }

    await this.record(task, "started", startedAt);
    try {
      const output = await task.execute();
      await this.record(task, "completed", startedAt);
      return { status: "completed", output };
    } catch (error) {
      await this.record(task, "failed", startedAt, "agent_task_failed");
      throw error;
    }
  }
}
