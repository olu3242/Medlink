import { createClient } from "@supabase/supabase-js";
import { describe,expect,it } from "vitest";
import { GreenbookManufacturerAdapter,GreenbookProductAdapter,manufacturerColumns,productColumns,type CsvRecord } from "./greenbook";
import { ingest } from "./pipeline";
import { SupabaseMerdpRepository } from "./database";

const url=process.env.MEDLINK_LIVE_SUPABASE_URL,key=process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live=url&&key?describe:describe.skip;
const csv=(columns:readonly string[],row:CsvRecord)=>`${columns.join(",")}\n${columns.map(c=>`"${(row[c]??"").replaceAll('"','""')}"`).join(",")}\n`;
const product=(overrides:Partial<CsvRecord>={}):CsvRecord=>({product_id:"EXIT-PRODUCT-1",ingredient_id:"EXIT-INGREDIENT-1",manufacturer_id:"EXIT-MFG-1",product_name:"Exit Gate Medicine",form_id:"EXIT-FORM-1",strength:"10 mg",NAFDAC:"EXIT-0001",product_category_id:"1",marketing_category_id:"1",applicant_id:"EXIT-APPLICANT",approval_date:"2026-01-01",expiry_date:"2099-12-31",route_id:"1",smpc:"",country_id:"NG",product_description:"Exit gate fixture",pack_size:"10 tablets",biosimilar:"0",atc:"EXIT",created_at:"2026-01-01",updated_at:"2026-01-01",deleted_at:"",status:"Active",composition:"Exit Ingredient",ingredient:"Exit Ingredient",form:"Tablet",applicant:"Exit Applicant",route:"Oral",product_category:"Drugs",category_name:"Drugs",ingredient_name:"Exit Ingredient",synonym:"Exit Medicine",form_name:"Exit Gate Tablet",applicant_name:"Exit Applicant",route_name:"Oral",DT_RowIndex:"1",...overrides});
const manufacturer=(name="Exit Manufacturer Ltd"):CsvRecord=>({manufacturer_id:"EXIT-MFG-1",manufacturer_name:name,product_count:"1",ingredient_count:"1",detail_url:"fixture",source_page:"1",source_position:"1",retrieved_at:new Date().toISOString()});

live("MERDP incremental snapshots",()=>{
  it("handles new, changed, missing, renamed, status, and expiry evidence",async()=>{
    const db=createClient(url!,key!,{auth:{persistSession:false}}),repo=new SupabaseMerdpRepository(db);
    const persist=async(adapter:GreenbookProductAdapter|GreenbookManufacturerAdapter,row:CsvRecord,columns:readonly string[],name:string)=>repo.persist(ingest({adapter,content:csv(columns,row),filePath:name,authority:"NAFDAC Greenbook controlled certification fixture"}),`fixture://${name}`);
    const state=async()=>{const r=await db.rpc("merdp_exit_fixture_state",{product_source_id:"EXIT-PRODUCT-1",manufacturer_source_id:"EXIT-MFG-1"});expect(r.error).toBeNull();return r.data as Record<string,unknown>;};
    await persist(new GreenbookManufacturerAdapter(),manufacturer(),manufacturerColumns,"manufacturer-a.csv");
    await persist(new GreenbookProductAdapter(),product(),productColumns,"product-a.csv");
    await repo.converge(); const initial=await state();
    expect(initial).toMatchObject({medicineStatus:"active",certification:"certified",publicationVersions:1,publicationEvents:1,productEvidence:1,manufacturerEvidence:1});
    const medicineId=initial.medicineId,organizationId=initial.organizationId;

    await persist(new GreenbookProductAdapter(),product({strength:"20 mg",updated_at:"2026-02-01"}),productColumns,"product-b.csv");
    await repo.converge(); const changed=await state();
    expect(changed).toMatchObject({medicineId,strength:"20 mg",productEvidence:2,publicationVersions:2,publicationEvents:2});

    await persist(new GreenbookManufacturerAdapter(),manufacturer("Exit Manufacturer Renamed Ltd"),manufacturerColumns,"manufacturer-b.csv");
    await repo.converge(); const renamed=await state();
    expect(renamed).toMatchObject({organizationId,organizationName:"Exit Manufacturer Renamed Ltd",manufacturerEvidence:2});

    await persist(new GreenbookProductAdapter(),product({strength:"20 mg",status:"Inactive",updated_at:"2026-03-01"}),productColumns,"product-c.csv");
    await repo.converge(); const inactive=await state();
    expect(inactive).toMatchObject({medicineId,medicineStatus:"draft",certification:"revoked",publicationVersions:2,publicationEvents:2,productEvidence:3});

    await persist(new GreenbookProductAdapter(),product({strength:"20 mg",expiry_date:"2020-01-01",updated_at:"2026-04-01"}),productColumns,"product-d.csv");
    await repo.converge(); const expired=await state();
    expect(expired).toMatchObject({medicineId,medicineStatus:"draft",certification:"revoked",productEvidence:4});

    await persist(new GreenbookProductAdapter(),product({product_id:"EXIT-OTHER",NAFDAC:"",category_name:"N/A"}),productColumns,"product-missing.csv");
    await persist(new GreenbookManufacturerAdapter(),{...manufacturer("Other Manufacturer"),manufacturer_id:"EXIT-OTHER-MFG"},manufacturerColumns,"manufacturer-missing.csv");
    await repo.converge(); const missing=await state();
    expect(missing).toMatchObject({medicineId,organizationId,productEvidence:4,manufacturerEvidence:2});
  },240000);
});
