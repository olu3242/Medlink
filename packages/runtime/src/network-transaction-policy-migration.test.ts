import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL(
  "../../../supabase/migrations/202608180070_network_transaction_policy.sql",
  import.meta.url,
), "utf8").toLowerCase();

describe("network transaction policy migration", () => {
  it("models source-specific freshness without embedding a business TTL", () => {
    expect(sql).toContain("create type public.inventory_source_type");
    expect(sql).toContain("create table public.inventory_freshness_policies");
    expect(sql).toContain("max_age_seconds integer not null");
    expect(sql).toContain("policy.source_type=source.source_type");
    expect(sql).not.toMatch(/interval\s+'\d+ (minute|hour|day)/);
  });

  it("keeps sync evidence append-only and stale inventory persisted", () => {
    expect(sql).toContain("inventory_source_sync_events_append_only");
    expect(sql).toContain("inventory freshness policy and sync evidence are append-only");
    expect(sql).not.toContain("delete from public.inventory_batches");
  });

  it("gates both patient discovery and new reservation locks", () => {
    expect(sql).toContain("public.is_inventory_batch_discoverable(id)");
    expect(sql).toContain("inventory_source_missing");
    expect(sql).toContain("inventory_source_stale");
    expect(sql).toContain("and public.is_inventory_batch_discoverable(batch.id)");
    expect(sql).toContain("inventory_lock_network_eligibility");
    expect(sql).toContain("inventory is not eligible for a new network reservation");
  });

  it("preserves existing obligations when Partner state changes", () => {
    expect(sql).not.toContain("update public.reservations set status='cancelled'");
    expect(sql).not.toContain("update public.payments set status='failed'");
    expect(sql).not.toContain("delete from public.inventory_locks");
  });

  it("persists authorized, idempotent payment reconciliation evidence", () => {
    expect(sql).toContain("create table public.payment_reconciliation_cases");
    expect(sql).toContain("unique(provider_event_reference)");
    expect(sql).toContain("payment_events_reconciliation_capture");
    expect(sql).toContain("verified provider authority is required");
    expect(sql).toContain("platform administrator role required");
    for (const reason of [
      "internal_pending_provider_paid", "internal_paid_provider_unconfirmed",
      "duplicate_provider_transaction", "orphan_provider_transaction",
      "late_success", "late_failure", "late_success_after_reservation_expiry",
    ]) expect(sql).toContain(reason);
  });
});
