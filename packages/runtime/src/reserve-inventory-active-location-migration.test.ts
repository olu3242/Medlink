import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL(
  "../../../supabase/migrations/202608170072_reserve_inventory_active_location_guard.sql",
  import.meta.url,
), "utf8").replace(/\r\n?/g, "\n").toLowerCase();

describe("reserve_inventory active pharmacy location guard migration", () => {
  it("rejects a reservation against a pharmacy location that is not active or is soft-deleted", () => {
    expect(sql).toContain("create or replace function public.reserve_inventory(");
    expect(sql).toContain("pharmacy location is not active");
    expect(sql).toMatch(
      /where location\.id = target_pharmacy_location_id\s+and location\.organization_id = target_organization_id\s+and location\.is_active\s+and location\.deleted_at is null/,
    );
  });

  it("does not revert the medicine identity guard 202608170062 already fixed", () => {
    expect(sql).toContain("batch.medicine_id is distinct from mar.requested_medicine_id");
  });

  it("does not revert the replay-payload validation 202607290020 already fixed", () => {
    expect(sql).toContain("idempotency key was already used for a different reservation");
    expect(sql).toContain("existing_lock.inventory_batch_id <> target_inventory_batch_id");
  });

  it("checks the active-location guard before touching the inventory batch, so a deactivated location fails closed regardless of batch state", () => {
    const guardIndex = sql.indexOf("pharmacy location is not active");
    const batchLookupIndex = sql.indexOf("select * into batch from public.inventory_batches");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(batchLookupIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(batchLookupIndex);
  });

  it("preserves the function's authenticated-only grant", () => {
    expect(sql).toContain(
      "revoke all on function public.reserve_inventory(\n  uuid, uuid, text, text, text, text, uuid, uuid, uuid, integer, timestamptz\n) from public;",
    );
    expect(sql).toContain(
      "grant execute on function public.reserve_inventory(\n  uuid, uuid, text, text, text, text, uuid, uuid, uuid, integer, timestamptz\n) to authenticated;",
    );
  });
});
