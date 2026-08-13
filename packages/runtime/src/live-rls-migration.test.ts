import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const sql=readFileSync("supabase/migrations/202608120023_live_rls_schema_visibility.sql","utf8").toLowerCase();
describe("live RLS schema visibility",()=>{it("grants read-only discovery and never exposes MERDP raw data",()=>{expect(sql.match(/grant select/g)).toHaveLength(7);expect(sql).not.toContain("etl_source_records");expect(sql).not.toMatch(/grant (insert|update|delete|all)/);});});
