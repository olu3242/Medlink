import type { LogAdapter, LogEntry } from "./logger.types";

export class CompositeLogAdapter implements LogAdapter {
  constructor(private readonly adapters: readonly LogAdapter[]) {}

  async write(entry: LogEntry): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.write(entry)));
  }
}

export class MemoryLogAdapter implements LogAdapter {
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}
