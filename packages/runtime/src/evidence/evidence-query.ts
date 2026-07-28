import type { EvidenceFilter, EvidenceRecord } from "./evidence-types";

export function matchesEvidence(record: EvidenceRecord, filter: EvidenceFilter): boolean {
  return (!filter.type || record.type === filter.type)
    && (!filter.category || record.category === filter.category)
    && (!filter.correlationId || record.correlationId === filter.correlationId)
    && (!filter.certificationProfile
      || record.certificationProfile === filter.certificationProfile)
    && (!filter.from || record.timestamp >= filter.from)
    && (!filter.to || record.timestamp <= filter.to);
}
