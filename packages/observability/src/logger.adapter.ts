import type { Logger } from "pino";
import type { LogAdapter, LogEntry } from "@medlink/runtime";

type PinoLogTarget = Pick<Logger, "trace" | "debug" | "info" | "warn" | "error" | "fatal">;

export class PinoLogAdapter implements LogAdapter {
  constructor(private readonly target: PinoLogTarget) {}

  write(entry: LogEntry): void {
    const {
      severity,
      message,
      timestamp,
      correlationId,
      requestId,
      tenantId,
      organizationId,
      userId,
      workflowId,
      conversationId,
      service,
      component,
      operation,
      durationMs,
      errorCode,
      attributes,
    } = entry;
    this.target[severity]({
      timestamp,
      correlation_id: correlationId,
      request_id: requestId,
      tenant_id: tenantId,
      organization_id: organizationId,
      user_id: userId,
      workflow_id: workflowId,
      conversation_id: conversationId,
      service,
      component,
      operation,
      duration_ms: durationMs,
      error_code: errorCode,
      ...attributes,
    }, message);
  }
}
