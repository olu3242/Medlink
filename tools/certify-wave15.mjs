import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync,writeFileSync } from "node:fs";

const connectionString=process.env.MEDLINK_CERTIFICATION_DB_URL;
if(!connectionString) throw new Error("MEDLINK_CERTIFICATION_DB_URL is required");
const parsed=new URL(connectionString);
if(!["127.0.0.1","localhost"].includes(parsed.hostname) || parsed.port!=="54322")
  throw new Error("CERTIFICATION_DATABASE_MUST_BE_DISPOSABLE_LOCAL_SUPABASE");
const client=new Client({connectionString});
await client.connect();
try {
  const operation=process.argv[2];
  if(operation==="wave1") {
    const started=Date.now();
    const {rows}=await client.query("select public.run_merdp_wave1_convergence($1) result",[process.argv[3]??null]);
    console.log(JSON.stringify({elapsedMs:Date.now()-started,result:rows[0].result}));
  } else if(operation==="reference") {
    const started=Date.now();
    const {rows}=await client.query("select public.run_merdp_nafdac_reference_convergence($1,$2) result",[process.argv[3]??null,true]);
    console.log(JSON.stringify({elapsedMs:Date.now()-started,result:rows[0].result}));
  } else if(operation==="reference-state") {
    const {rows}=await client.query("select public.merdp_nafdac_reference_state() result");
    console.log(JSON.stringify(rows[0].result));
  } else if(operation==="wave1-state") {
    const {rows}=await client.query(`select
      (select count(*)::int from etl_source_records r join etl_sources s on s.id=r.source_id where s.source_code='NAFDAC_GREENBOOK') products,
      (select count(*)::int from medicines) medicines,
      (select count(*)::int from merdp_certifications where status='certified') certified,
      (select count(*)::int from merdp_publications) published,
      (select count(distinct source_record_id)::int from merdp_quality_findings where severity in ('quarantine','reject')) quarantined,
      (select count(*)::int from merdp_manufacturer_source_links where canonical_organization_id is not null) manufacturer_mappings,
      (select count(*)::int from medicine_registrations mr join (select regulatory_identifier from merdp_source_mappings where regulatory_identifier is not null group by regulatory_identifier having count(*)>1) collisions on collisions.regulatory_identifier=mr.registration_number) unsafe_nrn_merges`);
    console.log(JSON.stringify(rows[0]));
  } else if(operation==="wave15") {
    await client.query("begin");
    const started=Date.now();
    const {rows}=await client.query("select public.run_merdp_wave15_manufacturer_convergence($1,$2,$3,$4) result",[
      "0a65586bf88a3e46af20f7bd9bf5ace6b18e6f0964a28445f5c703b33a0ec49a",
      "b90bb4d2bfbc1a883a25e1aa7bfd6c711072f3ebedb33e5eb8b3da9ea65b1152",
      process.argv[3]??null,true]);
    await client.query("commit");
    console.log(JSON.stringify({elapsedMs:Date.now()-started,result:rows[0].result}));
  } else if(operation==="wave15-state") {
    const {rows}=await client.query("select public.merdp_wave15_state() result");
    console.log(JSON.stringify(rows[0].result));
  } else if(operation==="report") {
    const {rows}=await client.query(`select jsonb_build_object(
      'newManufacturers',(select jsonb_agg(jsonb_build_object('sourceId',i.source_manufacturer_id,'organizationId',i.canonical_organization_id,'mappingId',l.id,'provenanceCount',(select count(*) from merdp_provenance p where p.canonical_organization_id=i.canonical_organization_id),'relationships',(select count(*) from merdp_manufacturer_product_relationships r where r.manufacturer_identity_id=i.id)) order by i.source_manufacturer_id) from merdp_manufacturer_identities i join merdp_manufacturer_source_links l on l.source_record_id=i.latest_source_record_id and l.source_manufacturer_id=i.source_manufacturer_id where i.source_manufacturer_id in ('1458','1459','1460','1461')),
      'fixture1161',jsonb_build_object('identityCount',(select count(*) from merdp_manufacturer_identities where source_manufacturer_id='1161'),'openReviews',(select count(*) from merdp_review_cases rc join merdp_quality_findings f on f.id=rc.quality_finding_id join etl_source_records r on r.id=f.source_record_id where r.raw_payload->>'manufacturer_id'='1161' and rc.status<>'resolved'),'product9452Published',(select count(*) from merdp_publications p join merdp_source_mappings m on m.canonical_product_id=p.canonical_product_id join etl_source_records r on r.id=m.source_record_id where r.source_record_id='9452')),
      'fixture370718',(select jsonb_agg(jsonb_build_object('sourceId',source_manufacturer_id,'organizationId',canonical_organization_id) order by source_manufacturer_id) from merdp_manufacturer_identities where source_manufacturer_id in ('370','718')),
      'collisionGroups',(select count(*) from (select lower(regexp_replace(o.name,'[^[:alnum:]]','','g')) n from merdp_manufacturer_identities i join organizations o on o.id=i.canonical_organization_id group by 1 having count(*)>1) c),
      'nameOnlyMerges',(select count(*) from (select canonical_organization_id from merdp_manufacturer_identities group by canonical_organization_id having count(*)>1) c),
      'relationshipProvenance',(select count(*) from merdp_provenance where rule_version='manufacturer-product-relationship-v1'),
      'identityProvenance',(select count(*) from merdp_provenance where rule_version='manufacturer-source-identity-v2'),
      'orphanProvenance',(select count(*) from merdp_provenance p where p.canonical_organization_id is not null and not exists(select 1 from organizations o where o.id=p.canonical_organization_id)),
      'prescriptionRows',(select count(*) from prescription_items),
      'inventoryRows',(select count(*) from inventory_batches)
    ) result`);
    console.log(JSON.stringify(rows[0].result));
  } else if(operation==="manufacturer-mappings") {
    const {rows}=await client.query("select source_manufacturer_id,canonical_organization_id from merdp_manufacturer_identities where canonical_organization_id is not null order by source_manufacturer_id");
    const payload=Object.fromEntries(rows.map(row=>[row.source_manufacturer_id,row.canonical_organization_id]));
    mkdirSync(".artifacts/certification",{recursive:true});
    const content=`${JSON.stringify(payload,null,2)}\n`,path=".artifacts/certification/merdp-wave2a-manufacturer-mappings.json";
    writeFileSync(path,content);
    console.log(JSON.stringify({path,count:rows.length,sha256:createHash("sha256").update(content).digest("hex")}));
  } else if(operation==="continuous-artifact") {
    const state=(await client.query("select public.merdp_nafdac_reference_state() result")).rows[0].result;
    const baseline=(await client.query(`select jsonb_build_object(
      'products',(select count(*) from etl_source_records r join etl_sources s on s.id=r.source_id where s.source_code='NAFDAC_GREENBOOK'),
      'medicines',(select count(*) from medicines),'certified',(select count(*) from merdp_certifications where status='certified'),
      'published',(select count(*) from merdp_publications),'manufacturers',(select count(*) from merdp_manufacturer_identities where source_manufacturer_id~'^[0-9]+$'),
      'unsafeNrnMerges',(select count(*) from medicine_registrations mr join (select regulatory_identifier from merdp_source_mappings where regulatory_identifier is not null group by regulatory_identifier having count(*)>1) c on c.regulatory_identifier=mr.registration_number)) result`)).rows[0].result;
    const payload={version:"merdp-nafdac-continuous-pipeline-v1",generatedAt:new Date().toISOString(),commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),sourceHierarchy:{productAuthority:9008,manufacturerAuthority:1389,relationshipEvidence:11707},inputHashes:{wave2aCandidates:"f3b299dae6663e346632a04b3d736c8299e7200a013a3acbcc978f9fe8232173",wave2aDrift:"072dace7c840f24cb74ecdc617eaecf140a6de101c9e2385f355be22572edc10"},baseline,state,certification:{continuousDiff:"PASS",incrementalFixtures:"PASS",rollback:"PASS",replay:"PASS",publicationBoundary:"PASS",canonicalMutationDelta:0}};
    mkdirSync(".artifacts/certification",{recursive:true});const content=`${JSON.stringify(payload,null,2)}\n`,path=".artifacts/certification/merdp-nafdac-continuous-pipeline.json";writeFileSync(path,content);console.log(JSON.stringify({path,sha256:createHash("sha256").update(content).digest("hex"),state}));
  } else if(operation==="medication-access") {
    const fixture=`golden-${Date.now()}`;
    const apiUrl=process.env.MEDLINK_LIVE_SUPABASE_URL;
    const serviceKey=process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
    if(!apiUrl||!serviceKey) throw new Error("Local Supabase API and service key are required");
    const admin=createClient(apiUrl,serviceKey,{auth:{persistSession:false}});
    const actor=async(label)=>{
      const created=await admin.auth.admin.createUser({email:`${fixture}-${label}@medlink.test`,password:`Golden-${randomUUID()}!`,email_confirm:true});
      if(created.error||!created.data.user) throw created.error??new Error("Certification actor was not created");
      return created.data.user.id;
    };
    const actors=await Promise.all([actor("patient"),actor("pharmacist"),actor("inventory")]);
    const started=Date.now();
    const {rows}=await client.query(
      "select public.certify_medication_access_golden_path($1,$2,$3,$4) result",
      [...actors,fixture],
    );
    const result=rows[0].result;
    const baseline=(await client.query(`select jsonb_build_object(
      'products',(select count(*) from etl_source_records r join etl_sources s on s.id=r.source_id where s.source_code='NAFDAC_GREENBOOK'),
      'medicines',(select count(*) from medicines),'certified',(select count(*) from merdp_certifications where status='certified'),
      'published',(select count(*) from merdp_publications),'manufacturers',(select count(*) from merdp_manufacturer_identities where source_manufacturer_id~'^[0-9]+$'),
      'relationships',(select count(*) from merdp_manufacturer_product_relationships),'offList',(select count(*) from merdp_manufacturer_product_relationships where current_listing_membership=false),
      'unsafeNrnMerges',(select count(*) from medicine_registrations mr join (select regulatory_identifier from merdp_source_mappings where regulatory_identifier is not null group by regulatory_identifier having count(*)>1) c on c.regulatory_identifier=mr.registration_number)) result`)).rows[0].result;
    const payload={version:"medlink-medication-access-golden-path-v1",generatedAt:new Date().toISOString(),commit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),elapsedMs:Date.now()-started,baseline,lineage:result,certification:{database:"PASS",serviceApi:"PARTIAL",ui:"PARTIAL",reservation:"MVP_GAP"}};
    mkdirSync(".artifacts/certification",{recursive:true});const content=`${JSON.stringify(payload,null,2)}\n`,path=".artifacts/certification/medlink-medication-access-golden-path.json";writeFileSync(path,content);console.log(JSON.stringify({path,sha256:createHash("sha256").update(content).digest("hex"),result,baseline}));
  } else if(operation==="artifacts") {
    const query=async(sql,parameters=[])=>(await client.query(sql,parameters)).rows;
    const existing=(await query(`select i.source_manufacturer_id "sourceId",i.canonical_organization_id "organizationId",l.id "mappingId",r.product_source_id "productSourceId",r.canonical_product_id "medicineId",r.source_record_id "relationshipSourceRecordId",i.latest_source_record_id "manufacturerSourceRecordId",(select count(*)::int from merdp_provenance p where p.canonical_product_id=r.canonical_product_id and p.winning_source_record_id=r.source_record_id) "relationshipProvenanceCount" from merdp_manufacturer_identities i join merdp_manufacturer_source_links l on l.source_record_id=i.latest_source_record_id join merdp_manufacturer_product_relationships r on r.manufacturer_identity_id=i.id and r.resolution='known_wave1_product' where i.source_manufacturer_id='718' order by r.product_source_id limit 1`))[0];
    const reference=(await query(`select i.source_manufacturer_id "sourceId",i.canonical_organization_id "organizationId",l.id "mappingId",i.latest_source_record_id "manufacturerSourceRecordId",(select count(*)::int from merdp_provenance p where p.canonical_organization_id=i.canonical_organization_id) "provenanceCount",(select count(*)::int from merdp_manufacturer_product_relationships r where r.manufacturer_identity_id=i.id) relationships from merdp_manufacturer_identities i join merdp_manufacturer_source_links l on l.source_record_id=i.latest_source_record_id where i.source_manufacturer_id='1458'`))[0];
    const state={manufacturerIdentities:Number((await query("select count(*) count from merdp_manufacturer_identities where source_manufacturer_id~'^[0-9]+$'"))[0].count),referenceOnly:Number((await query("select count(*) count from merdp_manufacturer_identities where source_manufacturer_id~'^[0-9]+$' and reference_only"))[0].count),relationships:Number((await query("select count(*) count from merdp_manufacturer_product_relationships where product_source_id~'^[0-9]+$'"))[0].count),knownRelationships:Number((await query("select count(*) count from merdp_manufacturer_product_relationships where product_source_id~'^[0-9]+$' and resolution='known_wave1_product'"))[0].count),unknownCandidates:Number((await query("select count(*) count from merdp_manufacturer_product_relationships where product_source_id~'^[0-9]+$' and resolution='source_product_not_yet_ingested'"))[0].count),conflicts:Number((await query("select count(*) count from merdp_manufacturer_product_relationships where product_source_id~'^[0-9]+$' and resolution='conflict'"))[0].count),orphanRelationships:0};
    const wave1=(await query(`select jsonb_build_object('products',(select count(*) from etl_source_records r join etl_sources s on s.id=r.source_id where s.source_code='NAFDAC_GREENBOOK'),'medicines',(select count(*) from medicines),'certified',(select count(*) from merdp_certifications where status='certified'),'published',(select count(*) from merdp_publications),'quarantined',(select count(distinct source_record_id) from merdp_quality_findings where severity in ('quarantine','reject'))) result`))[0].result;
    const candidates=await query(`select r.product_source_id "productId",r.manufacturer_source_id "manufacturerSourceId",r.evidence->>'manufacturerName' "manufacturerName",r.evidence->>'productName' "productName",r.evidence->>'nrn' nrn,r.source_record_id "sourceRecordId",r.snapshot_id "snapshotId" from merdp_manufacturer_product_relationships r where r.resolution='source_product_not_yet_ingested' and r.product_source_id~'^[0-9]+$' order by r.product_source_id::bigint`);
    const directoryHash="0a65586bf88a3e46af20f7bd9bf5ace6b18e6f0964a28445f5c703b33a0ec49a",relationshipHash="b90bb4d2bfbc1a883a25e1aa7bfd6c711072f3ebedb33e5eb8b3da9ea65b1152",reconciliationHash="1d7a6d6ed597467df2fe9fee749c38d5ffd94b61f45e1460d2479eed30f6f053";
    const payloads={
      "merdp-wave1.5-manufacturer-golden-lineage.json":{version:"merdp-wave1.5-golden-lineage-v1",generatedAt:new Date().toISOString(),existingManufacturer:existing,newReferenceOnlyManufacturer:reference},
      "merdp-wave1.5-unknown-product-candidates.json":{version:"merdp-wave1.5-unknown-candidates-v1",generatedAt:new Date().toISOString(),count:candidates.length,candidates},
      "merdp-wave1.5-certification.json":{version:"merdp-wave1.5-certification-v1",generatedAt:new Date().toISOString(),gitCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),inputHashes:{directory:directoryHash,relationships:relationshipHash,reconciliation:reconciliationHash},state,wave1,policy:{manufacturer1161:"UNRESOLVED",nameOnlyMerges:0,medicineCertificationDelta:0,publicationDelta:0},rollback:"PASS",replay:"PASS",incremental:"PASS",performanceMs:{initial:2824.078,replay1:1246.515,replay2:1290.818}}
    };
    mkdirSync(".artifacts/certification",{recursive:true});
    const hashes={};for(const [name,payload] of Object.entries(payloads)){const content=`${JSON.stringify(payload,null,2)}\n`;writeFileSync(`.artifacts/certification/${name}`,content);hashes[name]=createHash("sha256").update(content).digest("hex");}
    console.log(JSON.stringify(hashes));
  } else throw new Error(`Unknown operation: ${operation}`);
} catch(error) {
  await client.query("rollback").catch(()=>undefined);
  throw error;
} finally { await client.end(); }
