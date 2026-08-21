import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";

const sql=readFileSync("supabase/migrations/202608210076_merdp_fresh_manufacturer_identity_convergence.sql","utf8");

describe("MERDP fresh manufacturer identity convergence",()=>{
  it("binds service-role execution to an exact snapshot hash and count",()=>{
    expect(sql).toContain("auth.role() <> 'service_role'");
    expect(sql).toContain("sn.sha256=directory_sha256");
    expect(sql).toContain("sn.row_count=expected_row_count");
    expect(sql).toContain("MERDP_FRESH_MANUFACTURER_SNAPSHOT_MISMATCH");
  });
  it("adopts Wave 1 source mappings without name-based identity",()=>{
    expect(sql).toContain("l.canonical_organization_id");
    expect(sql).toContain("l.source_manufacturer_id");
    expect(sql).toContain("'namePrimaryKey',false");
    expect(sql).not.toContain("insert into public.organizations");
  });
  it("fails closed on ambiguous, reassigned, or merged identities",()=>{
    expect(sql).toContain("MERDP_FRESH_MANUFACTURER_MAPPING_AMBIGUOUS");
    expect(sql).toContain("MERDP_FRESH_MANUFACTURER_IDENTITY_REASSIGNMENT");
    expect(sql).toContain("MERDP_FRESH_MANUFACTURER_UNSAFE_MERGE");
  });
  it("is replay-safe and never changes medicine publication authority",()=>{
    expect(sql).toContain("on conflict(source_code,source_manufacturer_id) do update");
    expect(sql).toContain("on conflict(snapshot_id,manufacturer_identity_id) do update");
    expect(sql).not.toMatch(/insert into public\.(?:medicines|medicine_registrations|merdp_certifications|merdp_publications)/);
    expect(sql).not.toMatch(/delete from public\./);
  });
});
