import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { RuntimeContext } from "../index";
import { toRuntimeError } from "../index";
import { traceAttributes } from "./context";
import { Span } from "./span";
import type { SpanOptions, TraceAdapter } from "./trace-types";

const noopAdapter: TraceAdapter = {
  started: () => undefined,
  finished: () => undefined,
};

function identifier(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export class TraceManager {
  private readonly storage = new AsyncLocalStorage<Span>();

  constructor(
    private readonly adapter: TraceAdapter = noopAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  active(): Span | undefined {
    return this.storage.getStore();
  }

  start(context: RuntimeContext, options: SpanOptions): Span {
    const parent = this.active();
    return new Span({
      traceId: parent?.current.traceId ?? identifier(16),
      spanId: identifier(8),
      ...(parent ? { parentSpanId: parent.current.spanId } : {}),
      ...(options.parentTraceId ? { parentTraceId: options.parentTraceId } : {}),
      ...traceAttributes(context, options),
      startedAt: this.now(),
      status: "active",
    }, this.adapter, this.now);
  }

  async run<T>(
    context: RuntimeContext,
    options: SpanOptions,
    work: () => Promise<T>,
  ): Promise<T> {
    const span = this.start(context, options);
    return this.storage.run(span, async () => {
      try {
        const result = await work();
        span.finish();
        return result;
      } catch (error) {
        const runtimeError = toRuntimeError(error);
        span.fail({
          code: runtimeError.code,
          exceptionType: error instanceof Error ? error.name : "UnknownError",
          retryable: runtimeError.retryable,
          category: runtimeError.category,
        });
        throw error;
      }
    });
  }

  detached<T>(
    context: RuntimeContext,
    options: SpanOptions,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.storage.exit(() => this.run(context, options, work));
  }
}
