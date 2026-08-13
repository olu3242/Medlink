import { createHash } from "node:crypto";
import { existsSync,readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe,expect,it } from "vitest";
import { GreenbookManufacturerAdapter,GreenbookManufacturerProductAdapter } from "./greenbook";
import { ingest } from "./pipeline";
import { SupabaseMerdpRepository } from "./database";

const url=process.env.MEDLINK_LIVE_SUPABASE_URL,key=process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const directory=process.env.MEDLINK_WAVE15_DIRECTORY_CSV,relationships=process.env.MEDLINK_WAVE15_RELATIONSHIPS_CSV;
const live=url&&key&&directory&&relationships&&existsSync(directory)&&existsSync(relationships)?describe:describe.skip;
const hash=(content:string)=>createHash("sha256").update(content).digest("hex");

live("MERDP Wave 1.5 governed source-only ingestion",()=>{
  it("persists and replays both immutable artifacts without canonical mutation",async()=>{
    const db=createClient(url!,key!,{auth:{persistSession:false}}),repository=new SupabaseMerdpRepository(db);
    const canonical=async()=>{
      const [organizations,mappings,resolved,certifications,publications]=await Promise.all([
        db.from("organizations").select("id",{count:"exact",head:true}),
        db.from("merdp_manufacturer_source_links").select("id",{count:"exact",head:true}),
        db.from("merdp_review_cases").select("id",{count:"exact",head:true}).eq("status","resolved"),
        db.from("merdp_certifications").select("id",{count:"exact",head:true}),
        db.from("merdp_publications").select("id",{count:"exact",head:true})]);
      return [organizations.count,mappings.count,resolved.count,certifications.count,publications.count];
    };
    const before=await canonical();
    const sources=[{path:directory!,adapter:new GreenbookManufacturerAdapter()},{path:relationships!,adapter:new GreenbookManufacturerProductAdapter()}] as const;
    let persisted=0;
    for(const source of sources){const content=readFileSync(source.path,"utf8"),run=ingest({adapter:source.adapter,content,filePath:source.path,authority:"NAFDAC Greenbook",expectedSha256:hash(content)});const first=await repository.persist(run,source.path);expect(first.replay).toBe(false);persisted+=first.rawPersisted;const replay=await repository.persist(run,source.path);expect(replay).toMatchObject({replay:true,rawPersisted:0,findingsPersisted:0});}
    expect(persisted).toBeGreaterThan(1389);
    expect(await canonical()).toEqual(before);
  },240000);
  it("rejects a corrupted snapshot before persistence",async()=>{
    const content=readFileSync(directory!,"utf8");
    expect(()=>ingest({adapter:new GreenbookManufacturerAdapter(),content,filePath:directory!,authority:"NAFDAC Greenbook",expectedSha256:"0".repeat(64)})).toThrow("SOURCE_BASELINE_MISMATCH");
  });
});
