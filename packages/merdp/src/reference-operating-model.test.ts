import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/202608140028_merdp_nafdac_reference_operating_model.sql","utf8");
describe("NAFDAC continuous reference operating model",()=>{
  it("makes listing authority and off-list evidence explicit",()=>{
    for(const value of ["CURRENT_LISTED","OFF_LIST_SOURCE_EVIDENCE","SOURCE_INSUFFICIENT","INSUFFICIENT_EVIDENCE","HIGH_CONFIDENCE_HISTORICAL_EQUIVALENCE","AMBIGUOUS_EQUIVALENCE","CONFLICT"]) expect(sql).toContain(value);
  });
  it("preserves canonical and publication boundaries",()=>{
    expect(sql).toContain("NAFDAC_REFERENCE_CANONICAL_MUTATION_BOUNDARY_VIOLATION");
    expect(sql).toContain("current_listing_membership=p.id is not null");
    expect(sql).not.toMatch(/insert into public\.medicines/i);
    expect(sql).not.toMatch(/insert into public\.merdp_publications/i);
  });
  it("routes only ambiguity and conflict into the existing review system",()=>{
    expect(sql).toContain("OFF_LIST_EQUIVALENCE_REVIEW_REQUIRED");
    expect(sql).toContain("OFF_LIST_SOURCE_CONFLICT");
    expect(sql).not.toContain("SOURCE_INSUFFICIENT_REVIEW_REQUIRED");
  });
});
