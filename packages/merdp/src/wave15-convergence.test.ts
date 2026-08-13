import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

const sql=readFileSync("supabase/migrations/202608130027_merdp_wave15_manufacturer_convergence.sql","utf8");

describe("MERDP Wave 1.5 governed manufacturer convergence",()=>{
  it("uses source identity, never names, for deterministic organization identity",()=>{
    expect(sql).toContain("'NAFDAC_GREENBOOK_MANUFACTURERS:manufacturer:' || r.source_record_id");
    const identityExpression=sql.slice(sql.indexOf("extensions.uuid_generate_v5("),sql.indexOf("),\n    r.raw_payload->>'manufacturer_name'"));
    expect(identityExpression).toContain("r.source_record_id");
    expect(identityExpression).not.toContain("manufacturer_name");
    expect(sql).toContain("adoptedWave1Mapping");
  });
  it("preserves unknown products as evidence without canonical medicines",()=>{
    expect(sql).toContain("SOURCE_PRODUCT_NOT_YET_INGESTED");
    expect(sql).toContain("source_product_not_yet_ingested");
    expect(sql).not.toContain("insert into public.medicines");
    expect(sql).not.toContain("insert into public.merdp_certifications");
    expect(sql).not.toContain("insert into public.merdp_publications");
  });
  it("models absence without deletion or revocation",()=>{
    expect(sql).toContain("retain-identity-no-automatic-revocation");
    expect(sql).not.toMatch(/delete from public\.(?:organizations|merdp_manufacturer_identities)/);
    expect(sql).not.toMatch(/update public\.merdp_certifications/);
  });
  it("provides controlled failure and conflict stop gates",()=>{
    expect(sql).toContain("MERDP_WAVE15_CONTROLLED_FAILURE_AFTER_ORGANIZATIONS");
    expect(sql).toContain("MERDP_WAVE15_CONTROLLED_FAILURE_AFTER_RELATIONSHIPS");
    expect(sql).toContain("WAVE15_RELATIONSHIP_CONFLICTS");
  });
});
