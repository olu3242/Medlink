import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(
  `../../../supabase/migrations/${name}`,
  import.meta.url,
), "utf8").toLowerCase();

const schema = migration("202608240002_medicine_description_and_storage_evidence.sql");

describe("medicine description and storage evidence migration (P1 schema)", () => {
  it("adds product_description directly to medicines, not a second/duplicate table", () => {
    expect(schema).toContain("alter table public.medicines\n  add column product_description text");
  });

  it("keeps storage evidence RLS-enabled with a global read policy and platform-admin write, matching medicine_registrations' shape", () => {
    expect(schema).toContain("alter table public.medicine_storage_guidance enable row level security");
    expect(schema).toContain("create policy medicine_storage_guidance_read");
    expect(schema).toContain("create policy medicine_storage_guidance_admin");
    expect(schema).toContain("public.is_platform_admin()");
  });

  it("grants the backfill RPC only to service_role, never to authenticated or public", () => {
    expect(schema).toMatch(/revoke all on function public\.run_merdp_descriptive_evidence_backfill\(text\) from public/);
    expect(schema).toContain("grant execute on function public.run_merdp_descriptive_evidence_backfill(text) to service_role");
  });

  it("scopes authenticated clients to select-only on the storage evidence table", () => {
    expect(schema).toContain("grant select on public.medicine_storage_guidance to authenticated");
    expect(schema).not.toMatch(/grant\s+(insert|update|delete)\s+on\s+public\.medicine_storage_guidance\s+to\s+authenticated/);
  });

  it("bounds product_description length to prevent unbounded text injection through the projection", () => {
    expect(schema).toContain("char_length(product_description) between 1 and 4000");
  });
});
