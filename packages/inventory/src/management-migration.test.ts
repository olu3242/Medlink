import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "202607310020_pharmacy_inventory.sql",
  ),
  "utf8",
).toLowerCase();

describe("pharmacy inventory migration", () => {
  it("extends the canonical inventory and medicine ownership model", () => {
    expect(sql).toContain("alter table public.inventory_batches");
    expect(sql).not.toContain("create table public.inventory_batches");
    expect(sql).not.toContain("create table public.medicines");
    expect(sql).toContain("active canonical medicine was not found");
    expect(sql).toContain("unit_price_currency_code");
    expect(sql).toContain("inventory_batches_price_currency_pair");
  });

  it("keeps inventory arithmetic in database commands and lock triggers", () => {
    expect(sql).toContain("function public.change_inventory_stock");
    expect(sql).toContain("function public.record_inventory_lock_transaction");
    expect(sql).toContain("quantity_reserved_after <= quantity_on_hand_after");
    expect(sql).toContain("stock change would consume reserved inventory");
    expect(sql).toContain("inventory_locks_transaction_record");
  });

  it("records immutable transactions, audit, and transactional events", () => {
    expect(sql).toContain("create table public.inventory_transactions");
    expect(sql).toContain("inventory_transactions_append_only");
    expect(sql).toContain("runtime_outbox_events");
    expect(sql).toContain("governance_audit_events");
    for (const event of [
      "inventory.received.v1",
      "inventory.adjusted.v1",
      "inventory.reserved.v1",
      "inventory.released.v1",
      "inventory.dispensed.v1",
      "inventory.expired.v1",
      "inventory.low.v1",
    ]) {
      expect(sql).toContain(event);
    }
  });

  it("uses tenant-scoped role checks and revokes direct mutation", () => {
    expect(sql).toContain("public.has_organization_role");
    expect(sql).toContain(
      "revoke insert, update, delete on public.inventory_batches from authenticated",
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_inventory_batch\([\s\S]*?\) to authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.change_inventory_stock\([\s\S]*?\) to authenticated/,
    );
  });

  it("projects only fulfillment-safe FEFO availability", () => {
    expect(sql).toContain("function public.search_inventory_availability");
    expect(sql).toMatch(/order by\s+medicine\.id,\s+batch\.expires_on/);
    expect(sql).not.toContain("acquisition_cost_minor");
  });

  it("has an authorized expiry worker and no transaction boundary", () => {
    expect(sql).toContain("function public.release_expired_inventory_holds");
    expect(sql).toContain("auth.role()");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("commit;");
  });
});
