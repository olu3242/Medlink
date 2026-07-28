import type { RuntimeContext } from "../index";
import type { TraceManager } from "./trace-manager";

export function instrumentOperation<T>(
  manager: TraceManager,
  context: RuntimeContext,
  input: { service: string; component: string; operation: string },
  work: () => Promise<T>,
): Promise<T> {
  return manager.run(context, input, work);
}

export function instrumentRepository<T>(
  manager: TraceManager,
  context: RuntimeContext,
  input: { service: string; repository: string; operation: string },
  work: () => Promise<T>,
): Promise<T> {
  return manager.run(context, {
    service: input.service,
    component: `repository.${input.repository}`,
    operation: input.operation,
  }, work);
}
