import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceStore } from "./evidence-store";
import type { EvidenceFilter, EvidenceRecord } from "./evidence-types";

function row(record: EvidenceRecord) {
  return {
    id: record.id,
    evidence_type: record.type,
    category: record.category,
    source_component: record.sourceComponent,
    correlation_id: record.correlationId ?? null,
    trace_id: record.traceId ?? null,
    request_id: record.requestId ?? null,
    tenant_id: record.tenantId ?? null,
    organization_id: record.organizationId ?? null,
    runtime_version: record.runtimeVersion,
    platform_version: record.platformVersion,
    certification_profile: record.certificationProfile ?? null,
    evidence_timestamp: record.timestamp,
    integrity_hash: record.integrityHash,
    metadata: record.metadata,
    retention_class: record.retentionClass,
    evidence_version: record.version,
    parent_version_id: record.parentVersionId ?? null,
  };
}

function record(value: Record<string, unknown>): EvidenceRecord {
  const optional = (key: string) =>
    typeof value[key] === "string" ? value[key] as string : undefined;
  const correlationId = optional("correlation_id");
  const traceId = optional("trace_id");
  const requestId = optional("request_id");
  const tenantId = optional("tenant_id");
  const organizationId = optional("organization_id");
  const certificationProfile = optional("certification_profile");
  const parentVersionId = optional("parent_version_id");
  return Object.freeze({
    id: String(value.id),
    type: String(value.evidence_type),
    category: value.category as EvidenceRecord["category"],
    sourceComponent: String(value.source_component),
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    runtimeVersion: String(value.runtime_version),
    platformVersion: String(value.platform_version),
    ...(certificationProfile ? { certificationProfile } : {}),
    timestamp: String(value.evidence_timestamp),
    integrityHash: String(value.integrity_hash),
    metadata: Object.freeze((value.metadata ?? {}) as Record<string, string | number | boolean>),
    retentionClass: value.retention_class as EvidenceRecord["retentionClass"],
    version: Number(value.evidence_version),
    ...(parentVersionId ? { parentVersionId } : {}),
  });
}

export class SupabaseEvidenceStore implements EvidenceStore {
  constructor(private readonly database: SupabaseClient) {}

  async append(value: EvidenceRecord): Promise<void> {
    const { error } = await this.database.from("runtime_evidence_records").insert(row(value));
    if (error) throw new Error("Evidence persistence failed", { cause: error });
  }

  async get(id: string): Promise<EvidenceRecord | undefined> {
    const { data, error } = await this.database.from("runtime_evidence_records")
      .select("*").eq("id", id).maybeSingle();
    if (error) throw new Error("Evidence retrieval failed", { cause: error });
    return data ? record(data as Record<string, unknown>) : undefined;
  }

  async query(filter: EvidenceFilter): Promise<readonly EvidenceRecord[]> {
    let query = this.database.from("runtime_evidence_records")
      .select("*").order("evidence_timestamp", { ascending: false });
    if (filter.type) query = query.eq("evidence_type", filter.type);
    if (filter.category) query = query.eq("category", filter.category);
    if (filter.correlationId) query = query.eq("correlation_id", filter.correlationId);
    if (filter.certificationProfile) {
      query = query.eq("certification_profile", filter.certificationProfile);
    }
    if (filter.from) query = query.gte("evidence_timestamp", filter.from);
    if (filter.to) query = query.lte("evidence_timestamp", filter.to);
    const { data, error } = await query;
    if (error) throw new Error("Evidence query failed", { cause: error });
    return (data ?? []).map((item) => record(item as Record<string, unknown>));
  }
}
