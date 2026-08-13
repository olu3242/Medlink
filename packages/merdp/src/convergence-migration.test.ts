import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql=readFileSync("supabase/migrations/202608130024_merdp_wave1_convergence.sql","utf8");

describe("MERDP Wave 1 convergence migration",()=>{
  it("composes existing canonical masters and keeps regulatory IDs as evidence",()=>{
    expect(sql).toContain("insert into public.medicines");
    expect(sql).toContain("insert into public.organizations");
    expect(sql).not.toMatch(/create table public\.(?:merdp_medicines|greenbook_canonical_products)/);
    expect(sql).toContain("'nrnIsCanonicalKey', false");
    expect(sql).toContain("where nrn_count = 1");
  });
  it("requires provenance and certification before publication",()=>{
    expect(sql).toContain("insert into public.merdp_provenance");
    expect(sql).toContain("insert into public.merdp_certifications");
    expect(sql).toContain("from public.merdp_certifications c");
    expect(sql).toContain("where c.status = 'certified'");
  });
  it("does not acquire inventory or clinical substitution authority",()=>{
    expect(sql).not.toMatch(/insert into public\.inventory_/);
    expect(sql).not.toMatch(/insert into public\.medicine_equivalences/);
  });
});
