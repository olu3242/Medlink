import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paymentSql = readFileSync(new URL(
  "../../../supabase/migrations/202608170059_payment_obligation_and_provider_authority.sql",
  import.meta.url,
), "utf8").toLowerCase();
const discoverySql = readFileSync(new URL(
  "../../../supabase/migrations/202608170058_whatsapp_discovery_golden_fixture.sql",
  import.meta.url,
), "utf8").toLowerCase();

describe("payment convergence migration", () => {
  it("keeps one obligation with subordinate retryable provider attempts", () => {
    expect(paymentSql).toContain("create table public.payment_attempts");
    expect(paymentSql).toContain("pg_advisory_xact_lock");
    expect(paymentSql).toContain("payment-obligation:");
    expect(paymentSql).toContain("payment obligation is already satisfied");
  });

  it("resolves amount and currency from the locked inventory batch", () => {
    expect(paymentSql).toContain("batch.unit_price_minor * lock.quantity");
    expect(paymentSql).toContain("batch.unit_price_currency_code");
    expect(paymentSql).toContain("payment obligation does not match authoritative reservation price");
  });

  it("gates READY without replacing the credential-safe READY RPC", () => {
    expect(paymentSql).toContain("create trigger reservations_ready_payment_gate");
    expect(paymentSql).toContain("verified payment is required before readiness");
    expect(paymentSql).not.toContain("create or replace function public.mark_reservation_ready");
  });

  it("makes provider success service-role-only, idempotent, and late-event safe", () => {
    expect(paymentSql).toContain("verified provider authority is required");
    expect(paymentSql).toContain("provider_event_reference=target_provider_event_reference");
    expect(paymentSql).toContain("payment.late-success-reconciliation");
    expect(paymentSql).toContain("reconciliation_required=true");
  });

  it("removes direct authenticated financial writes", () => {
    expect(paymentSql).toContain("revoke insert,update,delete on public.payments from authenticated");
    expect(paymentSql).toContain("grant execute on function public.create_payment_attempt");
    expect(paymentSql).toContain(
      "grant select on public.payments,public.payment_events,public.payment_attempts to service_role",
    );
  });
});

describe("discovery fixture migration", () => {
  it("adds a related canonical option without a substitution decision", () => {
    expect(discoverySql).toContain("requested.generic_name");
    expect(discoverySql).toContain("genericinventorybatchid");
    expect(discoverySql).not.toContain("clinical_reviews");
  });
});
