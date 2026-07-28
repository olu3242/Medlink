import type { EvidenceFilter, EvidenceRecord } from "./evidence-types";
import { matchesEvidence } from "./evidence-query";

export interface EvidenceStore {
  append(record: EvidenceRecord): Promise<void>;
  get(id: string): Promise<EvidenceRecord | undefined>;
  query(filter: EvidenceFilter): Promise<readonly EvidenceRecord[]>;
}

export class MemoryEvidenceStore implements EvidenceStore {
  private readonly records = new Map<string, EvidenceRecord>();
  async append(record: EvidenceRecord): Promise<void> {
    if (this.records.has(record.id)) throw new Error("Evidence records are immutable");
    this.records.set(record.id, Object.freeze({
      ...record, metadata: Object.freeze({ ...record.metadata }),
    }));
  }
  async get(id: string): Promise<EvidenceRecord | undefined> {
    return this.records.get(id);
  }
  async query(filter: EvidenceFilter): Promise<readonly EvidenceRecord[]> {
    return [...this.records.values()].filter((record) => matchesEvidence(record, filter));
  }
}
