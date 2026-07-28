import { randomUUID } from "node:crypto";
import type { EvidenceStore } from "./evidence-store";
import type { EvidenceFilter, EvidenceInput, EvidenceRecord } from "./evidence-types";
import { evidenceHash } from "./evidence-version";

export class EvidenceRepository {
  constructor(
    private readonly store: EvidenceStore,
    private readonly id: () => string = randomUUID,
  ) {}

  async create(input: EvidenceInput): Promise<EvidenceRecord> {
    let version = 1;
    if (input.parentVersionId) {
      const parent = await this.store.get(input.parentVersionId);
      if (!parent) throw new Error("Parent evidence version does not exist");
      version = parent.version + 1;
    }
    const record: EvidenceRecord = Object.freeze({
      ...input,
      id: this.id(),
      version,
      integrityHash: evidenceHash(input, version),
      metadata: Object.freeze({ ...input.metadata }),
    });
    await this.store.append(record);
    return record;
  }

  get(id: string) { return this.store.get(id); }
  search(filter: EvidenceFilter = {}) { return this.store.query(filter); }

  verify(record: EvidenceRecord): boolean {
    const { id: _id, integrityHash: _hash, version, ...input } = record;
    void _id;
    void _hash;
    return evidenceHash(input, version) === record.integrityHash;
  }
}
