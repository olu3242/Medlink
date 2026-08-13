import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe,expect,it } from "vitest";
import { runWave15ManufacturerJob } from "./database-job";
import { GreenbookManufacturerAdapter,GreenbookManufacturerProductAdapter,manufacturerColumns,manufacturerProductColumns,type CsvRecord } from "./greenbook";
import { ingest } from "./pipeline";
import { SupabaseMerdpRepository } from "./database";

const url=process.env.MEDLINK_LIVE_SUPABASE_URL,key=process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY,connectionString=process.env.MEDLINK_CERTIFICATION_DB_URL;
const live=url&&key&&connectionString?describe:describe.skip;
const csv=(columns:readonly string[],rows:readonly CsvRecord[])=>`${columns.join(",")}\n${rows.map(row=>columns.map(c=>`"${(row[c]??"").replaceAll('"','""')}"`).join(",")).join("\n")}${rows.length?"\n":""}`;
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const manufacturer=(name:string):CsvRecord=>({manufacturer_id:"W15-FIXTURE",manufacturer_name:name,product_count:"0",ingredient_count:"0",detail_url:"fixture",source_page:"1",source_position:"1",retrieved_at:new Date().toISOString()});
const relationship:CsvRecord={manufacturer_source_id:"W15-FIXTURE",manufacturer_source_name:"Wave 15 Fixture Renamed",product_id:"W15-UNKNOWN-PRODUCT",product_name:"Future product",nrn:"",composition:"",detail_source_url:"fixture",retrieved_at:new Date().toISOString()};

live("MERDP Wave 1.5 incremental manufacturer semantics",()=>{
  it("preserves identity across rename, absence, reappearance, relationship add/remove",async()=>{
    const db=createClient(url!,key!,{auth:{persistSession:false}}),repo=new SupabaseMerdpRepository(db);
    const persist=async(adapter:GreenbookManufacturerAdapter|GreenbookManufacturerProductAdapter,content:string,name:string)=>{
      await repo.persist(ingest({adapter,content,filePath:name,authority:"controlled Wave 1.5 certification fixture"}),`fixture://${name}`);return sha(content);
    };
    const run=async(directory:string,relationships:string)=>runWave15ManufacturerJob({connectionString:connectionString!,directorySha256:directory,relationshipsSha256:relationships,enforceCertifiedBaseline:false});
    const emptyRelationships=csv(manufacturerProductColumns,[]),emptyRelationshipHash=await persist(new GreenbookManufacturerProductAdapter(),emptyRelationships,"w15-rel-empty.csv");
    const first=csv(manufacturerColumns,[manufacturer("Wave 15 Fixture")]),firstHash=await persist(new GreenbookManufacturerAdapter(),first,"w15-mfg-a.csv");
    await run(firstHash,emptyRelationshipHash);
    const firstIdentity=await db.from("merdp_manufacturer_identities").select("canonical_organization_id,source_state").eq("source_manufacturer_id","W15-FIXTURE").single();expect(firstIdentity.error).toBeNull();
    const renamed=csv(manufacturerColumns,[manufacturer("Wave 15 Fixture Renamed")]),renamedHash=await persist(new GreenbookManufacturerAdapter(),renamed,"w15-mfg-b.csv");
    await run(renamedHash,emptyRelationshipHash);
    const renamedIdentity=await db.from("merdp_manufacturer_identities").select("canonical_organization_id,source_state").eq("source_manufacturer_id","W15-FIXTURE").single();
    expect(renamedIdentity.data).toMatchObject({canonical_organization_id:firstIdentity.data!.canonical_organization_id,source_state:"present"});
    const emptyDirectory=csv(manufacturerColumns,[]),emptyDirectoryHash=await persist(new GreenbookManufacturerAdapter(),emptyDirectory,"w15-mfg-empty.csv");
    await run(emptyDirectoryHash,emptyRelationshipHash);
    expect((await db.from("merdp_manufacturer_identities").select("source_state").eq("source_manufacturer_id","W15-FIXTURE").single()).data?.source_state).toBe("absent");
    await run(renamedHash,emptyRelationshipHash);
    expect((await db.from("merdp_manufacturer_identities").select("canonical_organization_id,source_state").eq("source_manufacturer_id","W15-FIXTURE").single()).data).toMatchObject({canonical_organization_id:firstIdentity.data!.canonical_organization_id,source_state:"present"});
    const relationshipCsv=csv(manufacturerProductColumns,[relationship]),relationshipHash=await persist(new GreenbookManufacturerProductAdapter(),relationshipCsv,"w15-rel-add.csv");
    const added=await run(renamedHash,relationshipHash);expect(added.certificationDelta).toBe(0);expect(added.publicationDelta).toBe(0);
    const evidence=await db.from("merdp_manufacturer_product_relationships").select("resolution,is_current").eq("product_source_id","W15-UNKNOWN-PRODUCT").single();expect(evidence.data).toMatchObject({resolution:"source_product_not_yet_ingested",is_current:true});
    await run(renamedHash,emptyRelationshipHash);
    expect((await db.from("merdp_manufacturer_product_relationships").select("is_current").eq("product_source_id","W15-UNKNOWN-PRODUCT").single()).data?.is_current).toBe(false);
  },120000);
});
