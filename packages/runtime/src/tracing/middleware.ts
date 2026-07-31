import type { RuntimeContext } from "../index";
import { RuntimeTrace } from "./trace";
import type { TraceManager } from "./trace-manager";

export function tracingMiddleware(
  manager: TraceManager,
  service: string,
): RuntimeTrace {
  return new RuntimeTrace(manager, service);
}

export function tracedPhase<T>(
  manager: TraceManager,
  context: RuntimeContext,
  input: { service: string; phase: string; operation: string },
  work: () => Promise<T>,
): Promise<T> {
  return manager.run(context, {
    service: input.service,
    component: input.phase,
    operation: input.operation,
  }, work);
}
