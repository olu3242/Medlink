import { createHash, randomUUID } from "node:crypto";

export type FindingSeverity = "INFO" | "WARNING" | "QUARANTINE" | "REJECT";
export type ResolutionOutcome = "EXACT_MATCH" | "PROBABLE_MATCH" | "RENEWAL_OR_VERSION" | "VARIANT" | "IDENTIFIER_COLLISION" | "DISTINCT" | "UNRESOLVED";

export interface SourceAdapter<T> {
  readonly sourceSystem: string;
  readonly schemaVersion: string;
  parse(content: string): readonly T[];
  sourceRecordId(record: T): string;
  validate(record: T): readonly QualityFinding[];
}

export interface SourceManifest {
  readonly sourceName: string;
  readonly authority: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly schemaFingerprint: string;
  readonly schemaVersion: string;
  readonly runId: string;
}

export interface QualityFinding {
  readonly rule: string;
  readonly severity: FindingSeverity;
  readonly field?: string;
  readonly message: string;
}

export interface RawSourceRecord<T> {
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly snapshotHash: string;
  readonly raw: Readonly<T>;
  readonly findings: readonly QualityFinding[];
}

export interface EtlRunResult<T> {
  readonly runId: string;
  readonly manifest: SourceManifest;
  readonly records: readonly RawSourceRecord<T>[];
  readonly findings: readonly QualityFinding[];
  readonly rejected: number;
  readonly quarantined: number;
  readonly warnings: number;
  readonly durationMs: number;
}

export function fingerprint(columns: readonly string[]): string {
  return createHash("sha256").update(columns.join("\u001f")).digest("hex");
}

export function makeRunId(): string { return randomUUID(); }
