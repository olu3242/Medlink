import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "supabase/migrations/202608180068_partner_engine.sql"), "utf8").toLowerCase();
const readiness = readFileSync(join(process.cwd(), "supabase/migrations/202608180069_partner_location_network_readiness.sql"), "utf8").toLowerCase();

describe("Partner Engine migration", () => {
  it("normalizes the complete lifecycle without replacing organizations", () => {
    for (const table of ["partner_applications","partner_contacts","partner_identity_claims","partner_qualifications","partner_verification_records","partner_decisions","partner_requirements","partner_agreements","partner_integration_profiles","partner_readiness_assessments","partner_status_history","partner_lifecycle_events"]) {
      expect(migration).toContain(`create table public.${table}`);
    }
    expect(migration).not.toContain("create table public.partner_organizations");
    expect(migration).toContain("organization_id uuid references public.organizations");
  });

  it("keeps relationship and integration state independent", () => {
    expect(migration).toContain("partner_relationship_status");
    expect(migration).toContain("partner_integration_status");
    expect(migration).toContain("relationship_status public.partner_relationship_status");
    expect(migration).toContain("integration_status public.partner_integration_status");
  });

  it("prevents self-governance and direct mutations", () => {
    expect(migration).toContain("self-review is prohibited");
    expect(migration).toContain("self-governance is prohibited");
    expect(migration).toContain("self-certification is prohibited");
    expect(migration).toContain("revoke all on public.partner_applications");
    expect(migration).toContain("grant select on public.partner_applications");
    expect(migration).not.toContain("grant insert on public.partner_applications to authenticated");
  });

  it("uses applicant, tenant, and platform-admin RLS boundaries", () => {
    expect(migration).toContain("a.applicant_user_id=auth.uid()");
    expect(migration).toContain("public.is_platform_admin()");
    expect(migration).toContain("public.is_organization_member(a.organization_id)");
    expect((migration.match(/enable row level security/g) ?? [])).toHaveLength(12);
  });

  it("writes immutable history, audit, workflow, and outbox evidence", () => {
    expect(migration).toContain("partner_status_history_append_only");
    expect(migration).toContain("partner_lifecycle_events_append_only");
    expect(migration).toContain("insert into public.runtime_outbox_events");
    expect(migration).toContain("insert into public.governance_audit_events");
    expect(migration).toContain("'wf-016'");
  });
});

describe("Partner Network readiness migration", () => {
  it("derives readiness and exposes no writable network-ready flag", () => {
    expect(readiness).toContain("function public.partner_location_network_state");
    expect(readiness).not.toMatch(/^\s*network_ready\s+boolean/m);
    for (const blocker of ["partner_not_active","location_not_active","inventory_integration_unhealthy","inventory_not_current","inventory_freshness_policy_required","medication_mapping_ineligible","payment_capability_not_ready","fulfillment_capability_not_ready"]) expect(readiness).toContain(blocker);
  });

  it("requires governed freshness evidence without inventing a duration", () => {
    expect(readiness).toContain("freshness_policy_reference");
    expect(readiness).toContain("source_updated_at");
    expect(readiness).toContain("last_successful_sync");
    expect(readiness).not.toMatch(/interval\s+'\d+ (minute|hour|day)/);
  });

  it("converges canonical discovery on location eligibility", () => {
    expect(readiness).toContain("create or replace function public.search_inventory_availability");
    expect(readiness).toContain("public.is_location_network_eligible(location.id)");
  });
});
