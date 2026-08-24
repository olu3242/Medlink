import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL(
  "../../../supabase/migrations/202608170070_pharmacy_catalog_sku_mapping.sql",
  import.meta.url,
), "utf8").replace(/\r\n/g, "\n").toLowerCase();

describe("pharmacy catalog SKU mapping migration", () => {
  it("never makes a local SKU canonical medicine identity by itself", () => {
    expect(sql).toContain("create table public.pharmacy_catalog_items");
    // The catalog item row itself carries no medicine_id / canonical
    // reference at all -- only pharmacy_catalog_mappings does.
    const itemsTableBody = sql.slice(
      sql.indexOf("create table public.pharmacy_catalog_items"),
      sql.indexOf("create index pharmacy_catalog_items_location_idx"),
    );
    expect(itemsTableBody).not.toContain("medicine_id");
  });

  it("does not touch inventory_batches, search_inventory_availability, or reserve_inventory", () => {
    expect(sql).not.toContain("alter table public.inventory_batches");
    expect(sql).not.toContain("create or replace function public.search_inventory_availability");
    expect(sql).not.toContain("create or replace function public.reserve_inventory");
    expect(sql).not.toContain("create or replace function public.match_inventory");
  });

  it("enforces at most one current mapping per catalog item, and only when matched", () => {
    expect(sql).toContain("create unique index pharmacy_catalog_mappings_one_current_idx");
    expect(sql).toContain("on public.pharmacy_catalog_mappings(pharmacy_catalog_item_id)\n  where is_current");
    expect(sql).toContain("check (not is_current or mapping_status = 'matched')");
  });

  it("requires an active canonical medicine before a proposal or a confirm can reference it", () => {
    expect(sql).toContain("where id = target_medicine_id and status = 'active'");
    const occurrences = sql.match(/where id = target_medicine_id and status = 'active'/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("gates mapping confirm/reject to pharmacist only, fail-closed on ambiguity", () => {
    expect(sql).toContain("array['pharmacist']::public.member_role[]");
    expect(sql).toContain("only a pharmacist may decide a pharmacy catalog mapping");
    expect(sql).toContain("only a proposal awaiting decision may be confirmed or rejected");
  });

  it("never deletes a superseded mapping, only flips is_current", () => {
    expect(sql).toContain("set is_current = false");
    expect(sql).not.toMatch(/delete from public\.pharmacy_catalog_mappings/);
  });

  it("requires a non-empty rejection reason and full verified/rejected attribution", () => {
    expect(sql).toContain("a meaningful reason is required to reject a mapping");
    expect(sql).toContain(
      "(mapping_status = 'matched') = (verified_by is not null and verified_at is not null)",
    );
    expect(sql).toContain(
      "(mapping_status = 'rejected')\n    = (rejected_by is not null and rejected_at is not null and rejection_reason is not null)",
    );
  });

  it("routes every write through SECURITY DEFINER RPCs, not direct table grants", () => {
    expect(sql).toContain("revoke insert, update, delete on public.pharmacy_catalog_items from authenticated");
    expect(sql).toContain("revoke insert, update, delete on public.pharmacy_catalog_mappings from authenticated");
    expect(sql).toContain("grant execute on function public.create_pharmacy_catalog_item(");
    expect(sql).toContain("grant execute on function public.propose_pharmacy_catalog_mapping(");
    expect(sql).toContain("grant execute on function public.decide_pharmacy_catalog_mapping(");
  });

  it("grants table-level select to back its own RLS read policies", () => {
    expect(sql).toContain(
      "grant select on public.pharmacy_catalog_items, public.pharmacy_catalog_mappings\n  to authenticated, service_role",
    );
  });

  it("is idempotent per organization on all three RPCs", () => {
    expect(sql).toContain("unique (organization_id, idempotency_key)");
    const occurrences = sql.match(/unique \(organization_id, idempotency_key\)/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});
