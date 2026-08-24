import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(
  `../../../supabase/migrations/${name}`,
  import.meta.url,
), "utf8").toLowerCase();

const discovery = migration("202608180071_marketplace_discovery_authority.sql");
const transaction = migration("202608180072_cross_organization_transaction_authority.sql");
const fulfillment = migration("202608180073_cross_organization_fulfillment_continuity.sql");

describe("marketplace discovery authority migrations", () => {
  it("uses a narrow definer boundary without cross-tenant raw-table grants", () => {
    expect(discovery).toContain("security definer");
    expect(discovery).toContain("valid location consent is required");
    expect(discovery).toContain("public.is_inventory_batch_discoverable(batch.id)");
    expect(discovery).toContain("drop policy if exists pharmacy_locations_discovery_read");
    expect(discovery).toContain("grant execute on function public.discover_marketplace_inventory");
    expect(discovery).not.toMatch(/grant\s+select\s+on\s+public\.(inventory_batches|partner_applications)/);
  });

  it("returns only the minimized public marketplace projection", () => {
    for (const allowed of ["pharmacy_location_id", "pharmacy_name", "pharmacy_locality", "medicine_id", "distance_km", "availability_state", "unit_price_minor", "currency_code", "reservation_eligible"]) {
      expect(discovery).toContain(allowed);
    }
    for (const forbidden of ["supplier", "staff", "integration_credentials", "reconciliation_state", "audit_record"]) {
      expect(discovery).not.toContain(`${forbidden} text`);
    }
  });

  it("carries separate patient and pharmacy authorities through the existing workflow", () => {
    expect(transaction).toContain("pharmacy_organization_id");
    expect(transaction).toContain("inventory_organization_id");
    expect(transaction).toContain("public.is_inventory_batch_discoverable(batch.id)");
    expect(fulfillment).toContain("pharmacy_organization_id=target_organization_id");
    expect(fulfillment).toContain("lock.inventory_organization_id");
    expect(fulfillment).toContain("patient security context and payment obligation organization");
  });

  it("keeps the Partner browser helper service-role-only", () => {
    expect(transaction).toContain("certify_partner_browser_location_fixture");
    expect(transaction).toContain("auth.role()<>'service_role'");
    expect(transaction).toContain("grant execute on function public.certify_partner_browser_location_fixture");
    expect(transaction).not.toContain("grant execute on function public.certify_partner_browser_location_fixture(uuid,uuid,text)\nto authenticated");
  });
});
