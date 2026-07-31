import type { SpanSnapshot, TraceAdapter, TraceError } from "./trace-types";

export class Span {
  private snapshot: SpanSnapshot;

  constructor(
    initial: SpanSnapshot,
    private readonly adapter: TraceAdapter,
    private readonly now: () => number,
  ) {
    this.snapshot = initial;
    this.adapter.started(this.current);
  }

  get current(): Readonly<SpanSnapshot> {
    return { ...this.snapshot };
  }

  finish(): void {
    this.complete("succeeded");
  }

  fail(error: TraceError): void {
    this.complete("failed", error);
  }

  private complete(status: "succeeded" | "failed", error?: TraceError): void {
    if (this.snapshot.status !== "active") return;
    const endedAt = this.now();
    this.snapshot = {
      ...this.snapshot,
      status,
      endedAt,
      durationMs: endedAt - this.snapshot.startedAt,
      ...(error ? { error } : {}),
    };
    this.adapter.finished(this.current);
  }
}
