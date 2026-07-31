export type EvidenceCategory =
  | "runtime" | "observability" | "certification" | "security" | "quality";
export type RetentionClass =
  | "temporary" | "operational" | "audit" | "compliance" | "permanent";

export interface EvidenceInput {
  type: string;
  category: EvidenceCategory;
  sourceComponent: string;
  correlationId?: string;
  traceId?: string;
  requestId?: string;
  tenantId?: string;
  organizationId?: string;
  runtimeVersion: string;
  platformVersion: string;
  certificationProfile?: string;
  timestamp: string;
  metadata: Readonly<Record<string, string | number | boolean>>;
  retentionClass: RetentionClass;
  parentVersionId?: string;
}

export interface EvidenceRecord extends EvidenceInput {
  id: string;
  version: number;
  integrityHash: string;
}

export interface EvidenceFilter {
  type?: string;
  category?: EvidenceCategory;
  correlationId?: string;
  certificationProfile?: string;
  from?: string;
  to?: string;
}

export interface EvidenceProvider {
  name: string;
  collect(): Promise<readonly EvidenceInput[]>;
}
