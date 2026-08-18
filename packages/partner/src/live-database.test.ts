import { Client } from "pg";
import { describe, expect, it } from "vitest";

const connectionString=process.env.MEDLINK_CERTIFICATION_DB_URL;
const live=connectionString?describe:describe.skip;

live("Partner Engine live database",()=>{
  it("certifies applicant, reviewer, pharmacy handoff, network readiness, RLS, idempotency, and suspension",async()=>{
    const db=new Client({connectionString}); await db.connect();
    const applicant="a1000000-0000-4000-8000-000000000001";
    const reviewer="a1000000-0000-4000-8000-000000000002";
    const outsider="a1000000-0000-4000-8000-000000000003";
    try{
      await db.query("begin");
      const denied=async(sql:string,values:unknown[],pattern:RegExp)=>{
        await db.query("savepoint expected_denial");
        try{await db.query(sql,values);throw new Error("Expected database denial");}
        catch(error){expect(String((error as Error).message)).toMatch(pattern);}
        finally{await db.query("rollback to savepoint expected_denial");await db.query("release savepoint expected_denial");}
      };
      for(const [id,email] of [[applicant,"partner@e2e.medlink"],[reviewer,"reviewer@e2e.medlink"],[outsider,"outsider@e2e.medlink"]]) await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),'{"provider":"email","providers":["email"]}','{}',false,now(),now())`,[id,email]);
      const reviewerOrg=(await db.query(`insert into public.organizations(name,slug,type) values('Partner Review E2E','partner-review-e2e','technology') returning id`)).rows[0].id;
      const outsiderOrg=(await db.query(`insert into public.organizations(name,slug,type) values('Outside E2E','outside-partner-e2e','technology') returning id`)).rows[0].id;
      await db.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'platform_admin'),($3,$4,'tenant_admin')",[reviewerOrg,reviewer,outsiderOrg,outsider]);
      const actor=async(id:string)=>db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);
      await actor(applicant);
      const createArgs=["E2E Network Pharmacy","E2E Pharmacy","pharmacy","NG","https://partner.example","A governed pharmacy application for the continuous partner-to-patient test","E2E Owner","partner@e2e.medlink","+2348000000000","Owner","cac","RC-998877","create-e2e-partner","corr-partner-e2e"];
      const first=(await db.query("select (public.create_partner_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)).*",createArgs)).rows[0];
      const replay=(await db.query("select (public.create_partner_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)).*",createArgs)).rows[0];
      expect(replay.id).toBe(first.id);
      const submitted=(await db.query("select (public.submit_partner_application($1,$2,$3,$4)).*",[first.id,1,"submit-e2e-partner","corr-partner-e2e"])).rows[0];
      expect(submitted.relationship_status).toBe("under_review");
      await denied("select public.decide_partner_application($1,'approve',$2,null,$3,$4,$5)",[first.id,"Applicant must never approve their own relationship",2,"no-role-approve-e2e","corr-partner-e2e"],/administrator role/i);
      await db.query("insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'platform_admin')",[reviewerOrg,applicant]);
      await denied("select public.decide_partner_application($1,'approve',$2,null,$3,$4,$5)",[first.id,"Applicant must never approve their own relationship",2,"self-approve-e2e","corr-partner-e2e"],/self-review/i);
      await db.query("delete from public.organization_memberships where organization_id=$1 and user_id=$2",[reviewerOrg,applicant]);
      await actor(outsider);
      await db.query("set local role authenticated");
      expect((await db.query("select id from public.partner_applications where id=$1",[first.id])).rows).toEqual([]);
      await db.query("reset role");
      await actor(reviewer);
      const identityId=(await db.query("select id from public.partner_identity_claims where application_id=$1",[first.id])).rows[0].id;
      await db.query("select public.record_partner_verification($1,'identity',$2,'verified',$3,null,$4,$5,$6)",[first.id,identityId,"authority://cac/RC-998877","Registration identity matched authoritative evidence","verify-e2e-partner","corr-partner-e2e"]);
      const approved=(await db.query("select (public.decide_partner_application($1,'approve',$2,null,$3,$4,$5)).*",[first.id,"Verified identity and qualification evidence satisfy governed approval",3,"approve-e2e-partner","corr-partner-e2e"])).rows[0];
      expect(approved.organization_id).toBeTruthy();
      expect((await db.query("select count(*)::int count from public.organization_memberships where organization_id=$1 and user_id=$2 and role='pharmacy_owner'",[approved.organization_id,applicant])).rows[0].count).toBe(1);
      const location=(await db.query(`insert into public.pharmacy_locations(organization_id,name,license_number,address_line_1,locality,country_code,latitude,longitude) values($1,'E2E Partner Location','PCN-E2E-9988','1 Network Way','Lagos','NG',6.5244,3.3792) returning id`,[approved.organization_id])).rows[0].id;
      const agreement=(await db.query("select public.issue_partner_agreement($1,'partner_terms','mvp-2026-08',$2,$3,$4,$5) id",[first.id,"governed://partner-terms/mvp-2026-08","5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8","agreement-e2e-partner","corr-partner-e2e"])).rows[0].id;
      await actor(applicant);
      await db.query("select public.accept_partner_agreement($1,$2,$3,$4)",[first.id,agreement,"accept-e2e-partner","corr-partner-e2e"]);
      await actor(reviewer);
      await db.query("select public.record_partner_verification($1,'compliance',null,'verified',$2,null,$3,$4,$5)",[first.id,"authority://compliance/e2e","Compliance evidence verified by the independent reviewer","compliance-e2e-partner","corr-partner-e2e"]);
      await db.query("select public.update_partner_integration($1,'manual',null,array['identity','status','health','inventory'],'certified',$2,$3)",[first.id,"integration-e2e-partner","corr-partner-e2e"]);
      const now=new Date().toISOString();
      await db.query("select public.record_partner_location_capability($1,$2,'verified','healthy','current','eligible','ready','ready',$3,$4,$5,$6,null,$7,$8)",[first.id,location,"approved://inventory-freshness/mvp",now,now,"certification://partner-location/e2e","location-e2e-partner","corr-partner-e2e"]);
      const current=(await db.query("select version from public.partner_applications where id=$1",[first.id])).rows[0];
      const readiness=(await db.query("select public.assess_partner_readiness($1) value",[first.id])).rows[0].value;
      expect(readiness.ready,JSON.stringify(readiness)).toBe(true);
      const active=(await db.query("select (public.transition_partner_relationship($1,'activate',$2,$3,$4,$5)).*",[first.id,"All independently governed readiness requirements are satisfied",current.version,"activate-e2e-partner","corr-partner-e2e"])).rows[0];
      expect(active.relationship_status).toBe("active");
      expect((await db.query("select public.partner_location_network_state($1) value",[location])).rows[0].value).toMatchObject({networkReady:true,legacyNetwork:false,blockers:[]});
      const suspended=(await db.query("select (public.transition_partner_relationship($1,'suspend',$2,$3,$4,$5)).*",[first.id,"Controlled suspension blocks new discovery while obligations remain governed",active.version,"suspend-e2e-partner","corr-partner-e2e"])).rows[0];
      expect(suspended.relationship_status).toBe("suspended");
      expect((await db.query("select public.is_location_network_eligible($1) eligible",[location])).rows[0].eligible).toBe(false);
      expect((await db.query("select count(*)::int count from public.partner_lifecycle_events where application_id=$1",[first.id])).rows[0].count).toBeGreaterThan(8);
    }finally{await db.query("rollback");await db.end();}
  },120000);
});
