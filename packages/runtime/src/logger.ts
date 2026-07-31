import type {
  LogAdapter,
  LogContext,
  LogDetails,
  LogEntry,
  LogSeverity,
} from "./logger.types";

export class EnterpriseLogger {
  constructor(
    private readonly adapter: LogAdapter,
    private readonly context: LogContext,
    private readonly now: () => Date = () => new Date(),
  ) {}

  child(context: Partial<Pick<LogContext, "component" | "operation">>): EnterpriseLogger {
    return new EnterpriseLogger(
      this.adapter,
      { ...this.context, ...context },
      this.now,
    );
  }

  debug(message: string, details?: LogDetails): Promise<void> {
    return this.log("debug", message, details);
  }

  info(message: string, details?: LogDetails): Promise<void> {
    return this.log("info", message, details);
  }

  warn(message: string, details?: LogDetails): Promise<void> {
    return this.log("warn", message, details);
  }

  error(message: string, details?: LogDetails): Promise<void> {
    return this.log("error", message, details);
  }

  fatal(message: string, details?: LogDetails): Promise<void> {
    return this.log("fatal", message, details);
  }

  async log(
    severity: LogSeverity,
    message: string,
    details: LogDetails = {},
  ): Promise<void> {
    const entry: LogEntry = {
      ...this.context,
      timestamp: this.now().toISOString(),
      severity,
      message,
      durationMs: details.durationMs,
      errorCode: details.errorCode,
      attributes: details.attributes ?? {},
    };
    await this.adapter.write(entry);
  }
}
