import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const refundSql = readFileSync(new URL(
  "../../../supabase/migrations/202608170060_payment_refund_on_reservation_exit.sql",
  import.meta.url,
), "utf8").toLowerCase();

describe("payment refund on reservation exit migration", () => {
  it("only initiates a refund for a captured payment leaving confirmed/ready", () => {
    expect(refundSql).toContain("old.status in ('confirmed','ready') and new.status in ('cancelled','expired')");
    expect(refundSql).toContain("and status = 'captured'");
    expect(refundSql).toContain("create trigger reservations_refund_on_exit");
  });

  it("attributes the system-initiated refund to the ADR 0004 system identity", () => {
    expect(refundSql).toContain("initiated_by");
    expect(refundSql).toContain("'11111111-1111-4111-8111-111111111111'");
  });

  it("is idempotent per reservation and never double-refunds an already-refunded amount", () => {
    expect(refundSql).toContain("reservation-exit-refund:");
    expect(refundSql).toContain("on conflict (organization_id, idempotency_key) do nothing");
    expect(refundSql).toContain("outstanding := payment_row.amount_minor - refunded_total");
  });

  it("makes provider refund confirmation service-role-only and provider-event deduplicated", () => {
    expect(refundSql).toContain("verified provider authority is required");
    expect(refundSql).toContain("provider_refund_reference=target_provider_refund_reference");
    expect(refundSql).toContain("grant execute on function public.apply_refund_provider_event");
  });

  it("verifies amount and currency against the authoritative refund row before applying", () => {
    expect(refundSql).toContain("target_amount_minor<>refund_row.amount_minor");
    expect(refundSql).toContain("rejected_mismatch");
  });

  it("marks the payment refunded only once succeeded refunds cover the captured amount", () => {
    expect(refundSql).toContain("succeeded_total >= payment_row.amount_minor");
    expect(refundSql).toContain("then 'refunded' else 'partially_refunded'");
  });

  it("backs the pre-existing refunds RLS policy with the table-level grant it always lacked", () => {
    expect(refundSql).toContain("grant select on public.refunds to authenticated, service_role");
  });
});
