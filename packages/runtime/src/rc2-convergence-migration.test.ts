import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170045_mar_validation_review_handoff.sql",
), "utf8").toLowerCase();

const channelIdentitySql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170046_channel_identity_links.sql",
), "utf8").toLowerCase();

const clinicalWorkerRepairSql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170047_clinical_worker_parameter_resolution.sql",
), "utf8").toLowerCase();

const goldenLoopPharmacistFixtureSql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170048_golden_loop_pharmacist_fixture.sql",
), "utf8").toLowerCase();

const pharmacistReviewReadGrantsSql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170049_pharmacist_review_read_grants.sql",
), "utf8").toLowerCase();

const canonicalSearchAuthoritySql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170050_canonical_search_execution_authority.sql",
), "utf8").toLowerCase();

const canonicalProjectionReadGrantsSql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202608170051_canonical_projection_read_grants.sql",
), "utf8").toLowerCase();

describe("RC2 MAR validation to clinical review handoff", () => {
  it("creates the pending review and evidence in the validating transaction", () => {
    expect(sql).toContain("function public.validate_mar");
    expect(sql).toContain("insert into public.clinical_reviews");
    expect(sql).toContain("updated.prescription_id");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("retains actor, role, tenant, state, and concurrency guards", () => {
    expect(sql).toContain("target_actor_id is distinct from auth.uid()");
    expect(sql).toContain("array['pharmacist', 'pharmacy_staff']::public.member_role[]");
    expect(sql).toContain("organization_id = target_organization_id");
    expect(sql).toContain("and state = 'created'");
    expect(sql).toContain("on conflict (organization_id, idempotency_key)");
  });
});

describe("RC2 verified channel identity authority", () => {
  it("makes channel identity tenant-scoped and uniquely governed", () => {
    expect(channelIdentitySql).toContain("create table public.channel_identity_links");
    expect(channelIdentitySql).toContain("unique (organization_id, channel, channel_identity)");
    expect(channelIdentitySql).toContain("status public.channel_identity_link_status");
    expect(channelIdentitySql).toContain("status = 'verified'");
  });

  it("enables RLS and denies authenticated channel-link mutations", () => {
    expect(channelIdentitySql).toContain("enable row level security");
    expect(channelIdentitySql).toContain("channel_identity_links_admin_read");
    expect(channelIdentitySql).toContain("revoke insert, update, delete");
    expect(channelIdentitySql).toContain("grant select on public.channel_identity_links to authenticated, service_role");
  });
});

describe("RC2 clinical worker parameter resolution", () => {
  it("repairs every provider-pipeline worker command without replacing its authority", () => {
    for (const name of [
      "claim_clinical_pipeline_stage",
      "complete_clinical_ocr",
      "complete_clinical_parsing",
      "complete_clinical_validation",
      "fail_clinical_pipeline_stage",
    ]) expect(clinicalWorkerRepairSql).toContain(name);
    expect(clinicalWorkerRepairSql).toContain("pg_get_functiondef");
    expect(clinicalWorkerRepairSql).toContain("insert into public.ai_audit_events");
    expect(clinicalWorkerRepairSql).toContain("on conflict (organization_id, idempotency_key)");
    expect(clinicalWorkerRepairSql).toContain("claimed_stage <> ''clinical_validation''");
    expect(clinicalWorkerRepairSql).toContain("execute definition");
  });
});

describe("golden-loop clinical persona fixture", () => {
  it("keeps verified-pharmacist provisioning behind service-role-only authority", () => {
    expect(goldenLoopPharmacistFixtureSql).toContain("auth.role() <> 'service_role'");
    expect(goldenLoopPharmacistFixtureSql).toContain(
      "membership.role = 'pharmacist'::public.member_role",
    );
    expect(goldenLoopPharmacistFixtureSql).toContain("'verified', true, '2099-12-31'");
    expect(goldenLoopPharmacistFixtureSql).toContain("to service_role");
  });
});

describe("pharmacist review relation grants", () => {
  it("grants only reads for every RLS-protected review relation", () => {
    for (const relation of [
      "prescriptions",
      "prescription_items",
      "clinical_findings",
      "prescription_ocr_results",
      "clinical_evidence_packages",
      "prescription_files",
    ]) expect(pharmacistReviewReadGrantsSql).toContain(
      `grant select on public.${relation} to authenticated, service_role`,
    );
    expect(pharmacistReviewReadGrantsSql).not.toMatch(/grant (insert|update|delete|all)/);
  });
});

describe("canonical medicine search authority", () => {
  it("elevates only the bounded search function instead of catalog tables", () => {
    expect(canonicalSearchAuthoritySql).toContain(
      "alter function public.search_medicines(text, text[], integer, integer)",
    );
    expect(canonicalSearchAuthoritySql).toContain("security definer");
    expect(canonicalSearchAuthoritySql).not.toMatch(/grant .* on (table )?public\./);
  });
});

describe("canonical medicine projection grants", () => {
  it("adds read-only access for every RLS-protected embedded relation", () => {
    for (const relation of [
      "therapeutic_classes",
      "active_ingredients",
      "medicine_ingredients",
      "medicine_aliases",
      "medicine_registrations",
    ]) expect(canonicalProjectionReadGrantsSql).toContain(
      `grant select on public.${relation} to authenticated, service_role`,
    );
    expect(canonicalProjectionReadGrantsSql).not.toMatch(/grant (insert|update|delete|all)/);
  });
});
