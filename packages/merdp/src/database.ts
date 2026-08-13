import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EtlRunResult } from "./model";

type JsonRecord = Readonly<Record<string, string>>;
const chunks=<T>(values:readonly T[],size:number)=>Array.from({length:Math.ceil(values.length/size)},(_,i)=>values.slice(i*size,(i+1)*size));
function fail(error:{message:string}|null):void { if(error) throw new Error(error.message); }

export interface PersistedRun { readonly runId:string; readonly snapshotId:string; readonly replay:boolean; readonly rawPersisted:number; readonly findingsPersisted:number; }

export class SupabaseMerdpRepository {
  constructor(private readonly db:SupabaseClient) {}
  async persist(result:EtlRunResult<JsonRecord>,artifactUri:string):Promise<PersistedRun>{
    const sourceResult=await this.db.from("etl_sources").select("id").eq("source_code",result.manifest.sourceName).single(); fail(sourceResult.error);
    const sourceId=sourceResult.data!.id as string;
    const existingSnapshot=await this.db.from("etl_snapshots").select("id").eq("source_id",sourceId).eq("sha256",result.manifest.sha256).maybeSingle(); fail(existingSnapshot.error);
    if(existingSnapshot.data){
      const prior=await this.db.from("etl_runs").select("id").eq("snapshot_id",existingSnapshot.data.id).eq("status","completed").maybeSingle(); fail(prior.error);
      if(prior.data) return {runId:prior.data.id as string,snapshotId:existingSnapshot.data.id as string,replay:true,rawPersisted:0,findingsPersisted:0};
    }
    const snapshot=existingSnapshot.data ? {data:existingSnapshot.data,error:null} : await this.db.from("etl_snapshots").insert({
      source_id:sourceId,artifact_name:result.manifest.fileName,artifact_uri:artifactUri,sha256:result.manifest.sha256,
      byte_size:result.manifest.byteSize,schema_fingerprint:result.manifest.schemaFingerprint,row_count:result.manifest.rowCount,column_count:result.manifest.columnCount,
      metadata:{authority:result.manifest.authority,schemaVersion:result.manifest.schemaVersion}
    }).select("id").single(); fail(snapshot.error);
    const snapshotId=snapshot.data!.id as string;
    const run=await this.db.from("etl_runs").insert({source_id:sourceId,snapshot_id:snapshotId,status:"running",started_at:new Date().toISOString(),rows_read:result.records.length}).select("id").single(); fail(run.error);
    const runId=run.data!.id as string; let rawPersisted=0,findingsPersisted=0;
    for(const batch of chunks(result.records,250)){
      const inserted=await this.db.from("etl_source_records").insert(batch.map(record=>({source_id:sourceId,snapshot_id:snapshotId,run_id:runId,source_record_id:record.sourceRecordId,schema_version:result.manifest.schemaVersion,raw_payload:record.raw,raw_payload_sha256:createHash("sha256").update(JSON.stringify(record.raw)).digest("hex")}))).select("id,source_record_id"); fail(inserted.error);
      rawPersisted+=inserted.data!.length; const ids=new Map(inserted.data!.map(row=>[row.source_record_id as string,row.id as string]));
      const findings=batch.flatMap(record=>record.findings.map(f=>({run_id:runId,source_record_id:ids.get(record.sourceRecordId),rule_code:f.rule,field_name:f.field??null,severity:f.severity.toLowerCase(),message:f.message})));
      for(const findingBatch of chunks(findings,500)){const saved=await this.db.from("merdp_quality_findings").insert(findingBatch).select("id");fail(saved.error);findingsPersisted+=saved.data!.length;}
    }
    const completed=await this.db.from("etl_runs").update({status:"completed",completed_at:new Date().toISOString(),rows_valid:result.records.length-result.rejected,rows_warning:result.warnings,rows_quarantined:result.quarantined,rows_rejected:result.rejected,rows_staged:rawPersisted,metrics:{durationMs:result.durationMs}}).eq("id",runId);fail(completed.error);
    return {runId,snapshotId,replay:false,rawPersisted,findingsPersisted};
  }
}
