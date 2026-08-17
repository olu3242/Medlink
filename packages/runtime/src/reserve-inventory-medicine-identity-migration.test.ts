import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardSql = readFileSync(new URL(
  "../../../supabase/migrations/202608170062_reserve_inventory_medicine_identity_guard.sql",
  import.meta.url,
), "utf8").toLowerCase();
const replayValidationSql = readFileSync(new URL(
  "../../../supabase/migrations/202607290020_reserve_inventory_replay_validation.sql",
  import.meta.url,
), "utf8").toLowerCase();

describe("reserve_inventory medicine identity guard migration", () => {
  it("rejects an inventory batch whose medicine does not match the MAR's requested medicine", () => {
    expect(guardSql).toContain("if batch.medicine_id is distinct from mar.requested_medicine_id then");
    expect(guardSql).toContain("does not match the requested medicine");
  });

  it("keeps the identity check before the pharmacy-location/availability checks, not replacing them", () => {
    const identityCheckIndex = guardSql.indexOf("does not match the requested medicine");
    const locationCheckIndex = guardSql.indexOf("does not belong to the requested pharmacy location");
    const availabilityCheckIndex = guardSql.indexOf("inventory batch is not available");
    expect(identityCheckIndex).toBeGreaterThan(-1);
    expect(locationCheckIndex).toBeGreaterThan(identityCheckIndex);
    expect(availabilityCheckIndex).toBeGreaterThan(locationCheckIndex);
  });

  it("does not revert the replay-payload validation 202607290020 already fixed", () => {
    expect(guardSql).toContain("idempotency key was already used for a different reservation");
    expect(guardSql).toContain("existing_lock.inventory_batch_id <> target_inventory_batch_id");
    // Confirm the baseline this migration replaces really is the replay-
    // validated version, not the earlier one that lacked it.
    expect(replayValidationSql).toContain("existing_lock.inventory_batch_id <> target_inventory_batch_id");
  });

  it("keeps grants unchanged: authenticated only, no public execute", () => {
    expect(guardSql).toContain("revoke all on function public.reserve_inventory(");
    expect(guardSql).toContain("grant execute on function public.reserve_inventory(");
    expect(guardSql).toContain(") to authenticated;");
  });
});
