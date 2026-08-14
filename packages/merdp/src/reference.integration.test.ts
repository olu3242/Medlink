import {Client} from "pg";
import {describe,expect,it} from "vitest";

const connectionString=process.env.MEDLINK_CERTIFICATION_DB_URL;
const live=connectionString?describe:describe.skip;
const query=async<T=Record<string,unknown>>(sql:string,values:unknown[]=[]):Promise<T[]>=>{
  const client=new Client({connectionString});await client.connect();
  try{return (await client.query(sql,values)).rows as T[];} finally{await client.end();}
};

live("continuous NAFDAC reference convergence",()=>{
  it("rolls back a controlled failure",async()=>{
    await expect(query("select public.run_merdp_nafdac_reference_convergence($1,$2)",["after_classification",true])).rejects.toThrow("MERDP_REFERENCE_CONTROLLED_FAILURE_AFTER_CLASSIFICATION");
    const [state]=await query<{offList:number}>("select count(*)::int \"offList\" from merdp_manufacturer_product_relationships where source_state='OFF_LIST_SOURCE_EVIDENCE'");
    expect(state?.offList).toBe(0);
  },120000);
  it("classifies all evidence without canonical mutation and replays",async()=>{
    const canonical=async()=>query("select (select count(*)::int from medicines) medicines,(select count(*)::int from merdp_certifications) certifications,(select count(*)::int from merdp_publications) publications,(select count(*)::int from prescriptions) prescriptions,(select count(*)::int from inventory_batches) inventory");
    const before=await canonical();
    const [first]=await query<{result:Record<string,number>}>("select public.run_merdp_nafdac_reference_convergence(null,true) result");
    expect(first?.result).toMatchObject({relationships:11707,currentListed:9007,offList:2700,sourceInsufficient:2159,canonicalMedicineDelta:0,certificationDelta:0,publicationDelta:0});
    const [second]=await query<{result:Record<string,number>}>("select public.run_merdp_nafdac_reference_convergence(null,true) result");
    expect({...second?.result,durationMs:0}).toEqual({...first?.result,durationMs:0});
    expect(await canonical()).toEqual(before);
  },120000);
  it("preserves permanent safety fixtures",async()=>{
    const [state]=await query<{fixture370:number;fixture718:number;product2087OffList:number;fixture1161:number;product9452Published:number}>(`select
      (select count(*)::int from merdp_manufacturer_identities where source_manufacturer_id='370') "fixture370",
      (select count(*)::int from merdp_manufacturer_identities where source_manufacturer_id='718') "fixture718",
      (select count(*)::int from merdp_manufacturer_product_relationships where product_source_id='2087' and source_state='OFF_LIST_SOURCE_EVIDENCE') "product2087OffList",
      (select count(*)::int from merdp_manufacturer_identities where source_manufacturer_id='1161') "fixture1161",
      (select count(*)::int from merdp_publications p join merdp_source_mappings m on m.canonical_product_id=p.canonical_product_id join etl_source_records r on r.id=m.source_record_id where r.source_record_id='9452') "product9452Published"`);
    expect(state).toEqual({fixture370:1,fixture718:1,product2087OffList:1,fixture1161:0,product9452Published:0});
  });
});
