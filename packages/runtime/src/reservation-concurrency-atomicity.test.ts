import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), "utf8")
    .replace(/\r\n?/g, "\n")
    .toLowerCase();
}

const lockGuard = migration("202607270003_medication_access_core.sql");
const expiryWorker = migration("202608160037_reservation_expiry_audit_trail.sql");
const reserveInventory = migration("202608170072_reserve_inventory_active_location_guard.sql");

// Reservation concurrency / no-oversell certification: this suite does not
// modify reserve_inventory, sync_inventory_lock_quantity, or
// release_expired_inventory_holds -- all three already exist, unchanged.
// It certifies, by structural inspection, that the no-oversell invariant
// (available_quantity >= 0, no duplicate reservation/lock) is enforced at
// the database layer via a single conditional UPDATE guarded by a WHERE
// clause, not by any application-level or process-local lock -- Postgres
// serializes concurrent UPDATEs to the same row, so the guard is
// re-evaluated after acquiring the row lock, which is what makes it safe
// under real concurrency. packages/runtime/src/reservation-concurrency-
// live.test.ts exercises this mechanism against a real database.
describe("reservation concurrency atomicity (structural certification)", () => {
  it("enforces no-oversell via a single conditional UPDATE on inventory_batches, not an application-level lock", () => {
    expect(lockGuard).toContain("create or replace function public.sync_inventory_lock_quantity()");
    expect(lockGuard).toContain("update public.inventory_batches");
    expect(lockGuard).toContain("quantity_reserved = quantity_reserved + quantity_delta");
    expect(lockGuard).toContain("quantity_on_hand - consumed_quantity >= 0");
    expect(lockGuard).toContain(
      "quantity_reserved + quantity_delta between 0\n        and quantity_on_hand - consumed_quantity",
    );
    expect(lockGuard).toContain("if not found then");
    expect(lockGuard).toContain("raise exception 'insufficient or unavailable inventory for lock'");
  });

  it("fires the guard on every insert/update/delete of an inventory lock, so every reservation and every release goes through it", () => {
    expect(lockGuard).toContain(
      "create trigger inventory_locks_quantity_guard\nbefore insert or update or delete on public.inventory_locks",
    );
    expect(lockGuard).toContain("for each row execute function public.sync_inventory_lock_quantity();");
  });

  it("rejects deleting an inventory lock outright -- capacity can only be restored by a status transition the guard observes", () => {
    expect(lockGuard).toContain("inventory locks cannot be deleted");
  });

  it("guards quantity_reserved against being written by anything other than the lock trigger", () => {
    expect(lockGuard).toContain("create or replace function public.protect_inventory_reserved_quantity()");
    expect(lockGuard).toContain("quantity_reserved is maintained only by inventory locks");
  });

  it("releases expired holds with a concurrency-safe worker pattern (FOR UPDATE ... SKIP LOCKED), not a naive scan", () => {
    expect(expiryWorker).toContain("create or replace function public.release_expired_inventory_holds(");
    expect(expiryWorker).toContain("for update of lock skip locked");
    expect(expiryWorker).toContain("set status = 'expired'");
  });

  it("scopes idempotent reservation replay to (organization_id, idempotency_key), preventing duplicate reservations under concurrent replay", () => {
    expect(lockGuard).toContain("unique (organization_id, idempotency_key)");
    expect(reserveInventory).toContain(
      "select * into existing from public.reservations\n  where organization_id = target_organization_id\n    and idempotency_key = target_idempotency_key;",
    );
    expect(reserveInventory).toContain("exception when unique_violation then");
    expect(reserveInventory).toContain("an open reservation already exists for this medication access request");
  });

  it("still enforces the medicine-identity and active-location guards this branch certified earlier -- concurrency work did not regress them", () => {
    expect(reserveInventory).toContain("batch.medicine_id is distinct from mar.requested_medicine_id");
    expect(reserveInventory).toContain("pharmacy location is not active");
  });
});
