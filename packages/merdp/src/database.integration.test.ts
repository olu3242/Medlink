import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe,expect,it } from "vitest";
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
it("rejects raw mutation and anonymous raw access",async()=>{const service=createClient(url!,key!,{auth:{persistSession:false}});const row=await service.from("etl_source_records").select("id").limit(1).single();expect(row.error).toBeNull();const mutation=await service.from("etl_source_records").update({source_record_id:"forbidden"}).eq("id",row.data!.id);expect(mutation.error?.message).toMatch(/permission denied|raw ETL source records are immutable/i);const anonKey=process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY!;const anonymous=createClient(url!,anonKey,{auth:{persistSession:false}});const read=await anonymous.from("etl_source_records").select("id").limit(1);expect(read.error).not.toBeNull();});
});
