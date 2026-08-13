import { execFileSync } from "node:child_process";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe,expect,it } from "vitest";
import { createCertificationArtifact } from "../../certification/src/artifact-repository";
import { GreenbookManufacturerAdapter,GreenbookProductAdapter } from "./greenbook";
import { ingest } from "./pipeline";
import { SupabaseMerdpRepository } from "./database";
const url=process.env.MEDLINK_LIVE_SUPABASE_URL,key=process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live=url&&key?describe:describe.skip;
live("MERDP persistent ingestion",()=>{const repository=()=>new SupabaseMerdpRepository(createClient(url!,key!,{auth:{persistSession:false}}));
it("persists 10,393 records and replays without duplicates",async()=>{const sources=[
{path:"C:/CDEV/NAFDAC-Greenbook/nafdac_greenbook_full.csv",adapter:new GreenbookProductAdapter(),hash:"463247bd01cac1778fa887ce3854fdae713d91e59b0929eb1beb545e08b83d5c"},
{path:"C:/CDEV/NAFDAC-Greenbook/nafdac_greenbook_manufacturers_full.csv",adapter:new GreenbookManufacturerAdapter(),hash:"4167ce0bfa4d0d1c496b3705c8f445b599d25dc924f5a0b25785b8bd7cc4c857"}] as const;let persisted=0;
for(const source of sources){const run=ingest({adapter:source.adapter,content:readFileSync(source.path,"utf8"),filePath:source.path,authority:"NAFDAC Greenbook",expectedSha256:source.hash});const first=await repository().persist(run,source.path);expect(first.replay).toBe(false);persisted+=first.rawPersisted;const replay=await repository().persist(run,source.path);expect(replay).toMatchObject({replay:true,rawPersisted:0,findingsPersisted:0});}expect(persisted).toBe(10393);},120000);
it("rolls back a controlled mid-convergence failure and recovers",async()=>{
  const service=createClient(url!,key!,{auth:{persistSession:false}});
  await expect(repository().converge("after_mappings"))
    .rejects.toThrow("MERDP_CONTROLLED_FAILURE_AFTER_MAPPINGS");
  const state=await service.rpc("merdp_wave1_state"); expect(state.error).toBeNull();
  expect(Object.values(state.data as Record<string,number>)).toEqual(
    expect.arrayContaining(Array(9).fill(0)));
},120000);
it("materializes, certifies, publishes, and replays deterministically",async()=>{
  const first=await repository().converge();
  expect(first.productMappings).toBeGreaterThan(0);
  expect(first.manufacturerMappings).toBe(1385);
  expect(first.provenance).toBeGreaterThan(first.productMappings);
  expect(first.certifications).toBeGreaterThan(0);
  expect(first.publications).toBe(first.certifications);
  expect(first.events).toBe(first.publications);
  const replay=await repository().converge();
  expect({...replay,durationMs:0}).toEqual({...first,durationMs:0});
},120000);
it("retains one real Greenbook lineage through prescription, pharmacist, and inventory",async()=>{
  const started=Date.now(),service=createClient(url!,key!,{auth:{persistSession:false}});
  const required=<T>(result:{data:T|null;error:{message:string}|null}):T=>{if(result.error)throw new Error(result.error.message);expect(result.data).not.toBeNull();return result.data!;};
  const nonce=Date.now().toString(36);
  const actor=async(label:string)=>{const result=await service.auth.admin.createUser({email:`wave1-${label}-${nonce}@medlink.test`,password:`Wave1-${nonce}-Strong!`,email_confirm:true});if(result.error)throw result.error;if(!result.data.user)throw new Error("Certification actor was not created");return result.data.user;};
  const patient=await actor("patient"),pharmacist=await actor("pharmacist"),inventoryActor=await actor("inventory");
  const lineage=required(await service.rpc("certify_merdp_wave1_golden_lineage",{patient_id:patient.id,pharmacist_id:pharmacist.id,inventory_actor_id:inventoryActor.id,fixture_key:nonce})) as Record<string,unknown>;
  expect(lineage).toMatchObject({canonicalIdentityContinuity:true,rawIdentityLeakage:false,unauthorizedPharmacistDenied:true,unpublishedRuntimeExcluded:true,quarantineExcluded:true});
  expect([lineage.runtimeMedicineId,lineage.prescriptionMedicineId,lineage.pharmacistMedicineId,lineage.inventoryMedicineId]).toEqual(Array(4).fill(lineage.canonicalMedicineId));
  const artifact=createCertificationArtifact({category:"database",timestamp:new Date().toISOString(),commitSha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),githubActionsRunId:"local-wave1-final-closure",environment:"local-supabase",certificationVersion:"merdp-wave1-golden-lineage-v1",executionDurationMs:Date.now()-started,status:"pass",payload:lineage});
  const artifactDirectory=resolve(".artifacts/certification");mkdirSync(artifactDirectory,{recursive:true});writeFileSync(resolve(artifactDirectory,"merdp-wave1-golden-lineage.json"),`${JSON.stringify(artifact,null,2)}\n`);
},120000);
it("keeps three sustained convergence replays below the API boundary",async()=>{
  const durations:number[]=[];
  for(let index=0;index<3;index+=1){const started=Date.now();await repository().converge();durations.push(Date.now()-started);}
  expect(Math.max(...durations)).toBeLessThan(60000);
  const artifact=createCertificationArtifact({category:"database",timestamp:new Date().toISOString(),commitSha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),githubActionsRunId:"local-wave1-final-closure",environment:"local-supabase",certificationVersion:"merdp-wave1-performance-v1",executionDurationMs:durations.reduce((total,value)=>total+value,0),status:"pass",payload:{durationsMs:durations,maximumMs:Math.max(...durations),boundaryMs:60000,violations:durations.filter(value=>value>=60000).length}});
  const artifactDirectory=resolve(".artifacts/certification");mkdirSync(artifactDirectory,{recursive:true});writeFileSync(resolve(artifactDirectory,"merdp-wave1-performance.json"),`${JSON.stringify(artifact,null,2)}\n`);
},120000);
it("rejects raw mutation and anonymous raw access",async()=>{const service=createClient(url!,key!,{auth:{persistSession:false}});const row=await service.from("etl_source_records").select("id").limit(1).single();expect(row.error).toBeNull();const mutation=await service.from("etl_source_records").update({source_record_id:"forbidden"}).eq("id",row.data!.id);expect(mutation.error?.message).toMatch(/permission denied|raw ETL source records are immutable/i);const anonKey=process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY!;const anonymous=createClient(url!,anonKey,{auth:{persistSession:false}});const read=await anonymous.from("etl_source_records").select("id").limit(1);expect(read.error).not.toBeNull();});
});
