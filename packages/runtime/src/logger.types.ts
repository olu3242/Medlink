export const logSeverities = [
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

export type LogSeverity = (typeof logSeverities)[number];

export interface LogContext {
  correlationId: string;
  requestId: string;
  tenantId: string;
  organizationId: string;
  userId: string;
  workflowId?: string | undefined;
  conversationId?: string | undefined;
  service: string;
  component: string;
  operation: string;
}

export interface LogEntry extends LogContext {
  timestamp: string;
  severity: LogSeverity;
  message: string;
  durationMs?: number | undefined;
  errorCode?: string | undefined;
  attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface LogDetails {
  durationMs?: number | undefined;
  errorCode?: string | undefined;
  attributes?: Readonly<Record<string, string | number | boolean>> | undefined;
}

export interface LogAdapter {
  write(entry: LogEntry): void | Promise<void>;
}
