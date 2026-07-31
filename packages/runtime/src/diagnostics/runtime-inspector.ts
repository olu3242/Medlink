import type {
  DiagnosticEvent, DiagnosticFilter, DiagnosticStore,
} from "./diagnostic-types";

export class RuntimeInspector {
  constructor(private readonly store: DiagnosticStore) {}
  list(filter: DiagnosticFilter = {}): Promise<readonly DiagnosticEvent[]> {
    return this.store.query(filter);
  }
  find(id: string): Promise<DiagnosticEvent | undefined> {
    return this.store.get(id);
  }
}

export class MemoryDiagnosticStore implements DiagnosticStore {
  private readonly events = new Map<string, DiagnosticEvent>();

  async save(event: DiagnosticEvent): Promise<DiagnosticEvent> {
    const duplicate = [...this.events.values()].find((item) =>
      item.correlationId === event.correlationId
      && item.category === event.category
      && item.component === event.component);
    if (duplicate) {
      const updated = {
        ...duplicate,
        lastDetected: event.timestamp,
        occurrenceCount: duplicate.occurrenceCount + 1,
        evidence: [...new Set([...duplicate.evidence, ...event.evidence])],
      };
      this.events.set(updated.id, updated);
      return updated;
    }
    this.events.set(event.id, Object.freeze({ ...event }));
    return event;
  }

  async get(id: string): Promise<DiagnosticEvent | undefined> {
    return this.events.get(id);
  }

  async query(filter: DiagnosticFilter): Promise<readonly DiagnosticEvent[]> {
    return [...this.events.values()].filter((event) =>
      (!filter.severity || event.severity === filter.severity)
      && (!filter.category || event.category === filter.category)
      && (!filter.component || event.component === filter.component)
      && (!filter.correlationId || event.correlationId === filter.correlationId)
      && (!filter.from || event.timestamp >= filter.from)
      && (!filter.to || event.timestamp <= filter.to));
  }
}
