import type { RuntimeContext } from "../index";
import type { RuntimeTracing } from "./trace-types";
import { TraceManager } from "./trace-manager";

export class RuntimeTrace implements RuntimeTracing {
  constructor(
    private readonly manager: TraceManager,
    private readonly service: string,
  ) {}

  run<T>(
    context: RuntimeContext,
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.manager.run(context, {
      service: this.service,
      component: "runtime",
      operation,
    }, work);
  }

  phase<T>(
    context: RuntimeContext,
    component: string,
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.manager.run(context, {
      service: this.service,
      component,
      operation,
    }, work);
  }
}
