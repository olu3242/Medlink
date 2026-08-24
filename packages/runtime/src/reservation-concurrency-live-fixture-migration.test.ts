import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL(
  "../../../supabase/migrations/202608180080_reservation_concurrency_live_fixture.sql",
  import.meta.url,
), "utf8").toLowerCase();

describe("reservation concurrency live fixture migration", () => {
  it("is service-role-only and seeds no inventory_batches rows itself", () => {
    expect(sql).toContain("create or replace function public.certify_reservation_concurrency_fixture(");
    expect(sql).toContain("if auth.role() <> 'service_role'");
    expect(sql).not.toContain("insert into public.inventory_batches");
  });

  it("requires exactly 9 patient ids and seeds a second organization for the cross-tenant case", () => {
    expect(sql).toContain("if patient_ids is null or array_length(patient_ids, 1) <> 9 then");
    expect(sql).toContain("insert into public.organizations(id, name, slug, type) values");
    const orgInsertBlock = sql.slice(
      sql.indexOf("insert into public.organizations(id, name, slug, type) values"),
      sql.indexOf("insert into public.pharmacy_locations"),
    );
    expect((orgInsertBlock.match(/\(organization_id|\(other_organization_id/g) ?? []).length).toBe(2);
  });

  it("does not modify reserve_inventory, sync_inventory_lock_quantity, or release_expired_inventory_holds", () => {
    expect(sql).not.toContain("create or replace function public.reserve_inventory(");
    expect(sql).not.toContain("create or replace function public.sync_inventory_lock_quantity(");
    expect(sql).not.toContain("create or replace function public.release_expired_inventory_holds(");
  });

  it("grants execute to service_role only", () => {
    expect(sql).toContain(
      "revoke all on function public.certify_reservation_concurrency_fixture(text, uuid[]) from public;",
    );
    expect(sql).toContain(
      "grant execute on function public.certify_reservation_concurrency_fixture(text, uuid[]) to service_role;",
    );
  });
});
