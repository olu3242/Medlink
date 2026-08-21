import { createHash } from "node:crypto";
import { z } from "zod";
import { GreenbookManufacturerAdapter, GreenbookProductAdapter, type CsvRecord } from "./greenbook";
import { ingest, resolveProducts } from "./pipeline";
import type { ConvergenceResult, PersistedRun } from "./database";
import type { EtlRunResult } from "./model";

const sha256Schema=z.string().regex(/^[a-f0-9]{64}$/,"must be a lowercase SHA-256 digest");
const sourceSchema=z.object({
  path:z.string().min(1),artifactUri:z.string().min(1),sha256:sha256Schema,rowCount:z.number().int().positive(),
  columnCount:z.number().int().positive(),byteSize:z.number().int().positive(),
  sourceUrl:z.string().url(),retrievedAt:z.string().datetime({offset:true}),
});

export const bootstrapManifestSchema=z.object({
  version:z.literal("medlink-merdp-bootstrap-manifest-v1"),
  generatedAt:z.string().datetime({offset:true}),
  target:z.object({environment:z.enum(["development","test","preview","production"]),projectRef:z.string().regex(/^[a-z0-9]{20}$/)}),
  provenance:z.object({acquisitionCommit:z.string().regex(/^[a-f0-9]{40}$/),authority:z.literal("NAFDAC Greenbook")}),
  certifiedBaseline:z.object({
    products:z.object({rowCount:z.literal(9008),sha256:sha256Schema}),
    manufacturers:z.object({rowCount:z.literal(1385),sha256:sha256Schema}),
  }),
  sources:z.object({products:sourceSchema,manufacturers:sourceSchema}),
  drift:z.discriminatedUnion("status",[
    z.object({status:z.literal("none")}),
    z.object({status:z.literal("review_required"),reportSha256:sha256Schema,reasons:z.array(z.string().min(1)).min(1)}),
  ]),
});

export type BootstrapManifest=z.infer<typeof bootstrapManifestSchema>;
export type BootstrapMode="dry-run"|"apply";
export interface TargetState {readonly medicines:number;readonly manufacturers:number;readonly registrations:number;readonly rawRecords:number;}
export interface BootstrapSources {readonly products:string;readonly manufacturers:string;}
export interface BootstrapTarget {
  persist(result:EtlRunResult<CsvRecord>,artifactUri:string):Promise<PersistedRun>;
  converge():Promise<ConvergenceResult>;
}

export interface BootstrapPlan {
  readonly mode:BootstrapMode;readonly projectRef:string;readonly environment:BootstrapManifest["target"]["environment"];
  readonly sourceProducts:number;readonly sourceManufacturers:number;readonly rawRecordsExpected:number;
  readonly medicinesToInsert:number|null;readonly medicinesToUpdate:number|null;readonly manufacturersToInsert:number|null;
  readonly registrationsToInsert:number|null;readonly quarantines:number;readonly qualityFindings:number;
  readonly rejectedRows:number;readonly unsafeMerges:0;readonly duplicateNafdacConflicts:number;
  readonly ingredientConflictGroups:number;readonly unresolvedManufacturers:number;readonly sourceDrift:BootstrapManifest["drift"]["status"];
}

export interface ValidatedBootstrap {
  readonly manifest:BootstrapManifest;readonly products:EtlRunResult<CsvRecord>;readonly manufacturers:EtlRunResult<CsvRecord>;readonly plan:BootstrapPlan;
}

function digest(content:string):string{return createHash("sha256").update(content).digest("hex");}

function validateSource(label:"products"|"manufacturers",content:string,expected:BootstrapManifest["sources"][typeof label],result:EtlRunResult<CsvRecord>):void{
  const actual={sha256:digest(content),rowCount:result.manifest.rowCount,columnCount:result.manifest.columnCount,byteSize:Buffer.byteLength(content)};
  for(const field of ["sha256","rowCount","columnCount","byteSize"] as const){
    if(actual[field]!==expected[field]) throw new Error(`SOURCE_MANIFEST_MISMATCH:${label}:${field}:expected=${expected[field]}:actual=${actual[field]}`);
  }
}

export function validateBootstrap(input:{manifest:unknown;sources:BootstrapSources;mode:BootstrapMode;projectRef:string;environment:string;targetState:TargetState;approveDriftSha256?:string;allowProduction?:boolean;productionAuthorization?:string}):ValidatedBootstrap{
  const manifest=bootstrapManifestSchema.parse(input.manifest);
  if(input.projectRef!==manifest.target.projectRef) throw new Error("TARGET_PROJECT_MISMATCH");
  if(input.environment!==manifest.target.environment) throw new Error("TARGET_ENVIRONMENT_MISMATCH");
  if(manifest.target.environment==="production"&&(!input.allowProduction||input.productionAuthorization!==input.projectRef)) throw new Error("PRODUCTION_BOOTSTRAP_NOT_AUTHORIZED");
  const products=ingest({adapter:new GreenbookProductAdapter(),content:input.sources.products,filePath:manifest.sources.products.path,authority:manifest.sources.products.sourceUrl,expectedSha256:manifest.sources.products.sha256});
  const manufacturers=ingest({adapter:new GreenbookManufacturerAdapter(),content:input.sources.manufacturers,filePath:manifest.sources.manufacturers.path,authority:manifest.sources.manufacturers.sourceUrl,expectedSha256:manifest.sources.manufacturers.sha256});
  validateSource("products",input.sources.products,manifest.sources.products,products);
  validateSource("manufacturers",input.sources.manufacturers,manifest.sources.manufacturers,manufacturers);
  const resolution=resolveProducts(products.records.map(record=>record.raw),manufacturers.records.map(record=>record.raw));
  const registrations=new Set(products.records.map(record=>record.raw.NAFDAC).filter((value):value is string=>Boolean(value)));
  const rejectedRows=products.rejected+manufacturers.rejected;
  if(input.mode==="apply"&&rejectedRows>0) throw new Error("SOURCE_REJECTED_ROWS_PRESENT");
  if(input.mode==="apply"&&manifest.drift.status==="review_required"&&input.approveDriftSha256!==manifest.drift.reportSha256) throw new Error("SOURCE_DRIFT_NOT_AUTHORIZED");
  const emptyTarget=input.targetState.medicines===0&&input.targetState.manufacturers===0&&input.targetState.registrations===0&&input.targetState.rawRecords===0;
  const plan:BootstrapPlan={mode:input.mode,projectRef:input.projectRef,environment:manifest.target.environment,
    sourceProducts:products.manifest.rowCount,sourceManufacturers:manufacturers.manifest.rowCount,rawRecordsExpected:products.manifest.rowCount+manufacturers.manifest.rowCount,
    medicinesToInsert:emptyTarget?resolution.canonicalProductCandidates:null,medicinesToUpdate:emptyTarget?0:null,
    manufacturersToInsert:emptyTarget?manufacturers.manifest.rowCount:null,registrationsToInsert:emptyTarget?registrations.size:null,
    quarantines:products.quarantined+manufacturers.quarantined,qualityFindings:products.findings.length+manufacturers.findings.length,
    rejectedRows,unsafeMerges:0,duplicateNafdacConflicts:resolution.nrnCollisionGroups,ingredientConflictGroups:resolution.ingredientConflictGroups,
    unresolvedManufacturers:resolution.unresolvedManufacturer.length,sourceDrift:manifest.drift.status};
  return {manifest,products,manufacturers,plan};
}

export async function applyBootstrap(validated:ValidatedBootstrap,target:BootstrapTarget):Promise<{products:PersistedRun;manufacturers:PersistedRun;convergence:ConvergenceResult}>{
  if(validated.plan.mode!=="apply") throw new Error("DRY_RUN_CANNOT_MUTATE");
  const products=await target.persist(validated.products,validated.manifest.sources.products.artifactUri);
  const manufacturers=await target.persist(validated.manufacturers,validated.manifest.sources.manufacturers.artifactUri);
  const convergence=await target.converge();
  return {products,manufacturers,convergence};
}
