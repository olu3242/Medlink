import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.MEDLINK_LIVE_SUPABASE_URL;
const anonKey = process.env.MEDLINK_LIVE_SUPABASE_ANON_KEY;
const serviceKey = process.env.MEDLINK_LIVE_SUPABASE_SERVICE_KEY;
const live = url && anonKey && serviceKey ? describe : describe.skip;

// Pharmacy Onboarding -> SKU -> Inventory E2E, Phase 1 (foundational data
// model). Certifies the governance invariants of the new
// pharmacy_catalog_items / pharmacy_catalog_mappings layer against a real
// database: a local SKU is never canonical identity by itself; only a
// pharmacist decision can grant current-mapping authority; a non-
// pharmacist attempt fails closed; superseding a mapping preserves history
// rather than deleting it; and exactly one current mapping ever exists per
// catalog item.
live("pharmacy catalog SKU mapping governance", () => {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let service: SupabaseClient;
  let pharmacist: { id: string; client: SupabaseClient };
  let staff: { id: string; client: SupabaseClient };
  let fixture: {
    organizationId: string;
    pharmacyLocationId: string;
    medicineId: string;
    otherMedicineId: string;
  };

  async function actor(label: string): Promise<{ id: string; client: SupabaseClient }> {
    const email = `catalog-fixture-${label}-${nonce}@medlink.test`;
    const password = `CatalogFixture-${nonce}-Strong!`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error(`fixture actor "${label}" was not created`);
    }
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw signedIn.error ?? new Error(`fixture actor "${label}" could not sign in`);
    }
    return { id: created.data.user.id, client };
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    [pharmacist, staff] = await Promise.all([actor("pharmacist"), actor("staff")]);
    const { data, error } = await service.rpc("certify_pharmacy_catalog_fixture", {
      fixture_key: `catalog-${nonce}`,
      pharmacist_id: pharmacist.id,
      staff_id: staff.id,
    });
    if (error) throw error;
    fixture = data as typeof fixture;
  }, 60_000);

  function baseArgs(actorId: string) {
    return {
      target_organization_id: fixture.organizationId,
      target_actor_id: actorId,
      target_correlation_id: randomUUID(),
      target_request_id: `req-${randomUUID()}`,
      target_channel: "test",
    };
  }

  it("only a pharmacist decision can grant current-mapping authority, and it can be superseded without losing history", async () => {
    const itemKey = `${fixture.pharmacyLocationId}:item:${nonce}`;
    const createdItem = await staff.client.rpc("create_pharmacy_catalog_item", {
      ...baseArgs(staff.id),
      target_idempotency_key: itemKey,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_external_sku: `SKU-${nonce}`,
      target_source_product_name: "Catalog Fixture Medicine 500mg",
    });
    expect(createdItem.error, JSON.stringify(createdItem.error)).toBeNull();
    const item = createdItem.data as { id: string; external_sku: string };
    expect(item.external_sku).toBe(`SKU-${nonce}`);

    // Idempotent replay: the exact same key returns the same row, no
    // duplicate catalog item.
    const replayItem = await staff.client.rpc("create_pharmacy_catalog_item", {
      ...baseArgs(staff.id),
      target_idempotency_key: itemKey,
      target_pharmacy_location_id: fixture.pharmacyLocationId,
      target_external_sku: `SKU-${nonce}`,
    });
    expect(replayItem.error, JSON.stringify(replayItem.error)).toBeNull();
    expect((replayItem.data as { id: string }).id).toBe(item.id);

    const firstProposal = await staff.client.rpc("propose_pharmacy_catalog_mapping", {
      ...baseArgs(staff.id),
      target_idempotency_key: `${item.id}:propose-1`,
      target_pharmacy_catalog_item_id: item.id,
      target_medicine_id: fixture.medicineId,
      target_mapping_status: "review_required",
      target_mapping_method: "manual",
    });
    expect(firstProposal.error, JSON.stringify(firstProposal.error)).toBeNull();
    const proposal = firstProposal.data as { id: string; is_current: boolean; mapping_status: string };
    expect(proposal).toMatchObject({ is_current: false, mapping_status: "review_required" });

    // A non-pharmacist decision attempt must fail closed.
    const bypassAttempt = await staff.client.rpc("decide_pharmacy_catalog_mapping", {
      ...baseArgs(staff.id),
      target_idempotency_key: `${proposal.id}:bypass`,
      target_pharmacy_catalog_mapping_id: proposal.id,
      target_decision: "confirm",
      target_medicine_id: fixture.medicineId,
    });
    expect(bypassAttempt.error).not.toBeNull();
    expect(bypassAttempt.error?.message).toContain("Only a pharmacist may decide");

    const { data: unchangedAfterBypass, error: unchangedAfterBypassError } = await service
      .from("pharmacy_catalog_mappings")
      .select("is_current,mapping_status")
      .eq("id", proposal.id)
      .single();
    expect(unchangedAfterBypassError, JSON.stringify(unchangedAfterBypassError)).toBeNull();
    expect(unchangedAfterBypass).toMatchObject({ is_current: false, mapping_status: "review_required" });

    const confirmed = await pharmacist.client.rpc("decide_pharmacy_catalog_mapping", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${proposal.id}:confirm`,
      target_pharmacy_catalog_mapping_id: proposal.id,
      target_decision: "confirm",
      target_medicine_id: fixture.medicineId,
    });
    expect(confirmed.error, JSON.stringify(confirmed.error)).toBeNull();
    expect(confirmed.data).toMatchObject({
      is_current: true, mapping_status: "matched", medicine_id: fixture.medicineId,
    });

    // Propose and confirm a remap to a different medicine -- this must
    // supersede the first mapping (is_current flips false) without
    // deleting it, and never leave two simultaneously current rows.
    const secondProposal = await staff.client.rpc("propose_pharmacy_catalog_mapping", {
      ...baseArgs(staff.id),
      target_idempotency_key: `${item.id}:propose-2`,
      target_pharmacy_catalog_item_id: item.id,
      target_medicine_id: fixture.otherMedicineId,
      target_mapping_status: "review_required",
      target_mapping_method: "manual",
    });
    expect(secondProposal.error, JSON.stringify(secondProposal.error)).toBeNull();
    const secondProposalId = (secondProposal.data as { id: string }).id;

    const remapped = await pharmacist.client.rpc("decide_pharmacy_catalog_mapping", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${secondProposalId}:confirm`,
      target_pharmacy_catalog_mapping_id: secondProposalId,
      target_decision: "confirm",
      target_medicine_id: fixture.otherMedicineId,
    });
    expect(remapped.error, JSON.stringify(remapped.error)).toBeNull();
    expect(remapped.data).toMatchObject({ is_current: true, medicine_id: fixture.otherMedicineId });

    const { data: supersededFirst, error: supersededFirstError } = await service
      .from("pharmacy_catalog_mappings")
      .select("is_current,mapping_status,medicine_id")
      .eq("id", proposal.id)
      .single();
    expect(supersededFirstError, JSON.stringify(supersededFirstError)).toBeNull();
    expect(supersededFirst).toMatchObject({
      is_current: false, mapping_status: "matched", medicine_id: fixture.medicineId,
    });

    const { data: currentRows, error: currentRowsError } = await service
      .from("pharmacy_catalog_mappings")
      .select("id")
      .eq("pharmacy_catalog_item_id", item.id)
      .eq("is_current", true);
    expect(currentRowsError, JSON.stringify(currentRowsError)).toBeNull();
    expect(currentRows).toHaveLength(1);
    expect(currentRows?.[0]?.id).toBe(secondProposalId);

    // Rejection requires a meaningful reason and never touches the
    // existing current mapping.
    const thirdProposal = await staff.client.rpc("propose_pharmacy_catalog_mapping", {
      ...baseArgs(staff.id),
      target_idempotency_key: `${item.id}:propose-3`,
      target_pharmacy_catalog_item_id: item.id,
      target_medicine_id: fixture.medicineId,
      target_mapping_status: "conflict",
      target_mapping_method: "barcode",
    });
    expect(thirdProposal.error, JSON.stringify(thirdProposal.error)).toBeNull();
    const thirdProposalId = (thirdProposal.data as { id: string }).id;

    const reasonlessReject = await pharmacist.client.rpc("decide_pharmacy_catalog_mapping", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${thirdProposalId}:reject-reasonless`,
      target_pharmacy_catalog_mapping_id: thirdProposalId,
      target_decision: "reject",
    });
    expect(reasonlessReject.error).not.toBeNull();

    const rejected = await pharmacist.client.rpc("decide_pharmacy_catalog_mapping", {
      ...baseArgs(pharmacist.id),
      target_idempotency_key: `${thirdProposalId}:reject`,
      target_pharmacy_catalog_mapping_id: thirdProposalId,
      target_decision: "reject",
      target_rejection_reason: "Barcode collides with an unrelated pack size",
    });
    expect(rejected.error, JSON.stringify(rejected.error)).toBeNull();
    expect(rejected.data).toMatchObject({ mapping_status: "rejected", is_current: false });

    const { data: stillCurrent, error: stillCurrentError } = await service
      .from("pharmacy_catalog_mappings")
      .select("id")
      .eq("pharmacy_catalog_item_id", item.id)
      .eq("is_current", true)
      .single();
    expect(stillCurrentError, JSON.stringify(stillCurrentError)).toBeNull();
    expect(stillCurrent?.id).toBe(secondProposalId);
  });
});
