import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const connectionString = process.env.MEDLINK_CERTIFICATION_DB_URL;
const live = connectionString ? describe : describe.skip;

live("cross-organization transaction through the same Partner-generated pharmacy", () => {
  it("preserves one identity chain through freshness, payment, fulfillment, suspension, and recovery-safe replay", async () => {
    let db = new Client({ connectionString });
    await db.connect();
    const applicant = "a2000000-0000-4000-8000-000000000001";
    const reviewer = "a2000000-0000-4000-8000-000000000002";
    const patient = "a2000000-0000-4000-8000-000000000003";
    const pharmacist = "a2000000-0000-4000-8000-000000000004";
    const pharmacyStaff = "a2000000-0000-4000-8000-000000000005";
    const correlation = "a2000000-0000-4000-8000-000000000099";
    const actor = async (id: string, role = "authenticated") => {
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
        [id, role],
      );
    };
    const denied = async (sql: string, values: unknown[], pattern: RegExp) => {
      await db.query("savepoint expected_denial");
      try {
        await db.query(sql, values);
        throw new Error("Expected database denial");
      } catch (error) {
        expect(String((error as Error).message)).toMatch(pattern);
      } finally {
        await db.query("rollback to savepoint expected_denial");
        await db.query("release savepoint expected_denial");
      }
    };

    try {
      await db.query("begin");
      for (const [id, email] of [
        [applicant, "network-partner@e2e.medlink"],
        [reviewer, "network-reviewer@e2e.medlink"],
        [patient, "network-patient@e2e.medlink"],
        [pharmacist, "network-pharmacist@e2e.medlink"],
        [pharmacyStaff, "network-pharmacy-staff@e2e.medlink"],
      ]) {
        await db.query(
          `insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_super_admin,created_at,updated_at)
           values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),'{"provider":"email","providers":["email"]}','{}',false,now(),now())`,
          [id, email],
        );
      }
      const reviewerOrg = (await db.query(
        "insert into public.organizations(name,slug,type) values('Network Review E2E','network-review-e2e','technology') returning id",
      )).rows[0].id as string;
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'platform_admin')",
        [reviewerOrg, reviewer],
      );

      await actor(applicant);
      const application = (await db.query(
        "select (public.create_partner_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)).id id",
        ["Network Transaction Pharmacy", "Network Transaction Pharmacy", "pharmacy", "NG", "https://network.example", "Same pharmacy transaction convergence evidence", "Network Owner", "network-partner@e2e.medlink", "+2348000000100", "Owner", "cac", "RC-NETWORK-001", "network-create", correlation],
      )).rows[0] as { id: string };
      await db.query("select public.submit_partner_application($1,1,$2,$3)", [application.id, "network-submit", correlation]);

      await actor(reviewer);
      const identityId = (await db.query(
        "select id from public.partner_identity_claims where application_id=$1",
        [application.id],
      )).rows[0].id as string;
      await db.query(
        "select public.record_partner_verification($1,'identity',$2,'verified',$3,null,$4,$5,$6)",
        [application.id, identityId, "authority://cac/RC-NETWORK-001", "Verified Partner identity", "network-identity", correlation],
      );
      const approved = (await db.query(
        "select (public.decide_partner_application($1,'approve',$2,null,$3,$4,$5)).organization_id organization_id",
        [application.id, "Independent evidence approved", 3, "network-approve", correlation],
      )).rows[0] as { organization_id: string };
      const locationId = (await db.query(
        `insert into public.pharmacy_locations(organization_id,name,license_number,address_line_1,locality,country_code,latitude,longitude)
         values($1,'Same Network Pharmacy','PCN-NETWORK-001','1 Continuity Way','Lagos','NG',6.5244,3.3792) returning id`,
        [approved.organization_id],
      )).rows[0].id as string;
      const agreementId = (await db.query(
        "select public.issue_partner_agreement($1,'partner_terms','mvp-2026-08',$2,$3,$4,$5) id",
        [application.id, "governed://partner-terms/mvp-2026-08", "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8", "network-agreement", correlation],
      )).rows[0].id as string;
      await actor(applicant);
      await db.query("select public.accept_partner_agreement($1,$2,$3,$4)", [application.id, agreementId, "network-accept", correlation]);
      await actor(reviewer);
      await db.query(
        "select public.record_partner_verification($1,'compliance',null,'verified',$2,null,$3,$4,$5)",
        [application.id, "authority://compliance/network", "Compliance verified", "network-compliance", correlation],
      );
      await db.query(
        "select public.update_partner_integration($1,'manual',null,array['identity','status','health','inventory'],'certified',$2,$3)",
        [application.id, "network-integration", correlation],
      );
      const now = new Date();
      await db.query(
        "select public.record_partner_location_capability($1,$2,'verified','healthy','current','eligible','ready','ready',$3,$4,$4,$5,null,$6,$7)",
        [application.id, locationId, "certification://inventory-freshness/manual-network", now, "certification://location/network", "network-location", correlation],
      );
      const version = (await db.query("select version from public.partner_applications where id=$1", [application.id])).rows[0].version;
      await db.query(
        "select public.transition_partner_relationship($1,'activate',$2,$3,$4,$5)",
        [application.id, "Independent readiness prerequisites satisfied", version, "network-activate", correlation],
      );
      expect((await db.query("select public.is_location_network_eligible($1) eligible", [locationId])).rows[0].eligible).toBe(false);

      await db.query(
        "insert into public.inventory_freshness_policies(reference,source_type,max_age_seconds,approved_by,approval_evidence,effective_at) values($1,'manual',3600,$2,$3,now())",
        ["certification://inventory-freshness/manual-network", reviewer, "Certification-only one-hour profile; not a production default"],
      );
      await actor(applicant);
      const sourceId = (await db.query(
        "select (public.create_inventory_source($1,$2,'manual',$3,$4)).id id",
        [approved.organization_id, locationId, "Same Pharmacy Manual Source", "certification://inventory-freshness/manual-network"],
      )).rows[0].id as string;
      await db.query(
        "select public.record_inventory_source_sync($1,$2,'healthy',$3,$3,$4,$5)",
        [approved.organization_id, sourceId, now, "certification://source/network-fresh", "network-source-fresh"],
      );
      expect((await db.query("select public.is_location_network_eligible($1) eligible", [locationId])).rows[0].eligible).toBe(true);

      const patientOrganizationId = (await db.query(
        "insert into public.organizations(name,slug,type) values('Independent Patient E2E','independent-patient-e2e','clinic') returning id",
      )).rows[0].id as string;
      await db.query(
        `insert into public.organization_memberships(organization_id,user_id,role)
         values($1,$2,'patient'),($1,$3,'pharmacist'),($4,$5,'pharmacy_staff')`,
        [patientOrganizationId, patient, pharmacist, approved.organization_id, pharmacyStaff],
      );
      const medicineId = (await db.query(
        `insert into public.medicines(brand_name,generic_name,dosage_form,route,strength_display,pack_size,manufacturer_name,status)
         values('Network Exact Medicine','Network Generic Ingredient','tablet','oral','10 mg','30 tablets','MedLink Certification','active') returning id`,
      )).rows[0].id as string;
      const genericMedicineId = (await db.query(
        `insert into public.medicines(brand_name,generic_name,dosage_form,route,strength_display,pack_size,manufacturer_name,status)
         values('Network Generic Alternative','Network Generic Ingredient','tablet','oral','10 mg','30 tablets','MedLink Certification','active') returning id`,
      )).rows[0].id as string;
      // 202608240001 requires a currently-valid medicine_registrations row
      // for a medicine to appear in discover_marketplace_inventory at all
      // (exact or generic_related) -- without these, every assertion below
      // that expects a result row would regress to NONE_AVAILABLE.
      for (const registeredMedicineId of [medicineId, genericMedicineId]) {
        await db.query(
          `insert into public.medicine_registrations(medicine_id,country_code,authority_code,registration_number,valid_from,valid_until)
           values($1,'NG','NAFDAC',$2,current_date - interval '1 year',current_date + interval '1 year')`,
          [registeredMedicineId, `NETWORK-REG-${registeredMedicineId}`],
        );
      }
      const inventoryDocument = {
        pharmacyLocationId: locationId,
        medicineId,
        batchNumber: "NETWORK-BATCH-001",
        expiresOn: "2099-12-31",
        quantity: 3,
        unit: "pack",
        unitPriceMinor: 2500,
        currencyCode: "NGN",
        lowStockThreshold: 1,
      };
      const inventoryId = (await db.query(
        "select public.create_inventory_batch($1,$2::jsonb,$3,$4,$5) value",
        [approved.organization_id, JSON.stringify(inventoryDocument), "network-inventory-create", correlation, correlation],
      )).rows[0].value.inventoryId as string;
      await db.query(
        "select public.attach_inventory_batch_source($1,$2,$3,$4)",
        [approved.organization_id, inventoryId, sourceId, now],
      );

      await actor(patient);
      const consentId = (await db.query(
        "select (public.capture_marketplace_location_consent($1,$2,$3)).id id",
        [patientOrganizationId, patient, "network-marketplace-consent"],
      )).rows[0].id as string;
      await denied(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,null)",
        [patientOrganizationId, medicineId], /valid location consent is required/i,
      );
      await denied(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [approved.organization_id, medicineId, consentId], /authenticated patient context/i,
      );
      await denied(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, correlation], /valid location consent is required/i,
      );
      const discovered = (await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows;
      expect(discovered).toHaveLength(1);
      expect(discovered[0]).toMatchObject({ inventory_id: inventoryId, pharmacy_location_id: locationId, medicine_id: medicineId });
      expect(Number(discovered[0].unit_price_minor)).toBe(2500);

      // Deterministic three-pharmacy measurement: A is the Partner-generated
      // exact result, B is an eligible generic result, and C is deliberately
      // excluded after its location becomes inactive.
      const pharmacyB = (await db.query(
        "insert into public.organizations(name,slug,type) values('Network Pharmacy B','network-pharmacy-b','pharmacy') returning id",
      )).rows[0].id as string;
      const pharmacyC = (await db.query(
        "insert into public.organizations(name,slug,type) values('Network Pharmacy C','network-pharmacy-c','pharmacy') returning id",
      )).rows[0].id as string;
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$3,'inventory_manager'),($2,$3,'inventory_manager')",
        [pharmacyB, pharmacyC, applicant],
      );
      const locationB = (await db.query(
        `insert into public.pharmacy_locations(organization_id,name,license_number,address_line_1,locality,country_code,latitude,longitude)
         values($1,'Network Pharmacy B','PCN-NETWORK-002','2 Continuity Way','Lagos','NG',6.5344,3.3792) returning id`,
        [pharmacyB],
      )).rows[0].id as string;
      const locationC = (await db.query(
        `insert into public.pharmacy_locations(organization_id,name,license_number,address_line_1,locality,country_code,latitude,longitude)
         values($1,'Network Pharmacy C','PCN-NETWORK-003','3 Continuity Way','Lagos','NG',6.5444,3.3792) returning id`,
        [pharmacyC],
      )).rows[0].id as string;
      await actor(applicant);
      const sourceB = (await db.query(
        "select (public.create_inventory_source($1,$2,'manual',$3,$4)).id id",
        [pharmacyB, locationB, "Network B Source", "certification://inventory-freshness/manual-network"],
      )).rows[0].id as string;
      const sourceC = (await db.query(
        "select (public.create_inventory_source($1,$2,'manual',$3,$4)).id id",
        [pharmacyC, locationC, "Network C Source", "certification://inventory-freshness/manual-network"],
      )).rows[0].id as string;
      for (const [organizationId, pharmacyLocationId, source, batch, mappedMedicine, price] of [
        [pharmacyB, locationB, sourceB, "NETWORK-BATCH-002", genericMedicineId, 2200],
        [pharmacyC, locationC, sourceC, "NETWORK-BATCH-003", medicineId, 2100],
      ] as const) {
        await db.query(
          "select public.record_inventory_source_sync($1,$2,'healthy',$3,$3,$4,$5)",
          [organizationId, source, now, `certification://source/${batch}`, `network-sync-${batch}`],
        );
        const created = (await db.query(
          "select public.create_inventory_batch($1,$2::jsonb,$3,$4,$4) value",
          [organizationId, JSON.stringify({ pharmacyLocationId, medicineId: mappedMedicine, batchNumber: batch, expiresOn: "2099-12-31", quantity: 3, unit: "pack", unitPriceMinor: price, currencyCode: "NGN", lowStockThreshold: 1 }), `network-create-${batch}`, correlation],
        )).rows[0].value.inventoryId as string;
        await db.query("select public.attach_inventory_batch_source($1,$2,$3,$4)", [organizationId, created, source, now]);
      }
      await db.query("update public.pharmacy_locations set is_active=false where id=$1", [locationC]);
      await actor(patient);
      const startedAt = performance.now();
      const measured = (await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows;
      const queryDurationMs = performance.now() - startedAt;
      const repeated = (await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows;
      expect(measured.map(({ inventory_id, relationship }) => [inventory_id, relationship])).toEqual(
        repeated.map(({ inventory_id, relationship }) => [inventory_id, relationship]),
      );
      expect(measured.map(({ relationship }) => relationship)).toEqual(["exact", "generic_related"]);
      expect(measured.some(({ pharmacy_location_id }) => pharmacy_location_id === locationC)).toBe(false);
      expect((await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5344,3.3792,1,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows.map(({ relationship }) => relationship)).toEqual(["generic_related"]);
      expect((await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,999,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows).toHaveLength(0);
      console.info("NETWORK_MULTI_PHARMACY_MEASUREMENT", {
        candidatePharmacies: 3, eligiblePharmacies: 2, excludedPharmacies: 1,
        exclusionReasons: { [locationC]: "location_not_active" }, resultCount: measured.length,
        outcome: "BOTH_AVAILABLE", queryDurationMs: Number(queryDurationMs.toFixed(3)),
      });
      await db.query(
        "update public.inventory_batches set unit_price_minor=2600 where id=$1 and organization_id=$2",
        [inventoryId, approved.organization_id],
      );

      const marId = (await db.query(
        "select (public.create_mar($1,$2,$3,$3,$4,'web',$2,null,$5,$6)).id id",
        [patientOrganizationId, patient, correlation, "network-mar", medicineId, "Cross-organization exact medication"],
      )).rows[0].id as string;
      await actor(pharmacist);
      await db.query(
        "select public.validate_mar($1,$2,$3,$3,$4,'web',$5)",
        [patientOrganizationId, pharmacist, correlation, "network-validate", marId],
      );
      const reviewId = (await db.query(
        "select id from public.clinical_reviews where mar_id=$1 and organization_id=$2",
        [marId, patientOrganizationId],
      )).rows[0].id as string;
      await db.query(
        "select public.decide_clinical_review($1,$2,$3,$3,$4,'web',$5,'approved',$6)",
        [patientOrganizationId, pharmacist, correlation, "network-review", reviewId, "Exact canonical identity approved"],
      );
      await actor(patient);
      await db.query(
        "select public.match_inventory($1,$2,$3,$3,$4,'web',$5,$6,$7)",
        [patientOrganizationId, patient, correlation, "network-match", marId, inventoryId, locationId],
      );
      const reservationId = (await db.query(
        "select (public.reserve_inventory($1,$2,$3,$3,$4,'web',$5,$6,$7,1,now()+interval '30 minutes')).id id",
        [patientOrganizationId, patient, correlation, "network-reserve", marId, locationId, inventoryId],
      )).rows[0].id as string;
      await actor(pharmacyStaff);
      await db.query(
        "select public.decide_reservation($1,$2,$3,$3,$4,'web',$5,'confirmed',null)",
        [approved.organization_id, pharmacyStaff, correlation, "network-confirm", reservationId],
      );
      await actor(patient);
      const paymentAttempt = (await db.query(
        "select public.create_payment_attempt($1,$2,$3,'certified-simulator',$4,$5,$5) value",
        [patientOrganizationId, patient, reservationId, "network-payment-attempt", correlation],
      )).rows[0].value as { paymentId: string; providerReference: string; amountMinor: number };
      expect(Number(paymentAttempt.amountMinor)).toBe(2600);
      await actor(reviewer, "service_role");
      expect((await db.query(
        "select public.apply_payment_provider_event($1,$2,'succeeded',2600,'NGN') value",
        ["network-provider-event", paymentAttempt.providerReference],
      )).rows[0].value.outcome).toBe("succeeded");
      expect((await db.query(
        "select public.apply_payment_provider_event($1,$2,'succeeded',2600,'NGN') value",
        ["network-provider-duplicate", paymentAttempt.providerReference],
      )).rows[0].value.outcome).toBe("already_satisfied");
      const duplicateCaseId = (await db.query(
        "select id from public.payment_reconciliation_cases where payment_id=$1 and reason='duplicate_provider_transaction'",
        [paymentAttempt.paymentId],
      )).rows[0].id as string;
      await actor(reviewer);
      await db.query(
        "select public.resolve_payment_reconciliation_case($1,$2,$3)",
        [duplicateCaseId, "Duplicate evidence reviewed; single captured payment retained", "provider-evidence://duplicate-transaction"],
      );
      const beforeRestart = {
        patientOrganizationId, pharmacyOrganizationId: approved.organization_id,
        locationId, inventoryId, medicineId, reservationId,
        paymentId: paymentAttempt.paymentId, providerReference: paymentAttempt.providerReference,
        patient, pharmacyStaff, correlation, pickupHash: "a".repeat(64),
      };
      await db.query("commit");
      await db.end();
      const resumed = spawnSync(process.execPath, [fileURLToPath(new URL(
        "./fixtures/network-restart-worker.mjs", import.meta.url,
      ))], {
        encoding: "utf8",
        env: { ...process.env, MEDLINK_RESTART_PAYLOAD: JSON.stringify(beforeRestart) },
      });
      db = new Client({ connectionString });
      await db.connect();
      await db.query("begin");
      expect(resumed.status, resumed.stderr).toBe(0);
      const restartEvidence = JSON.parse(resumed.stdout.trim()) as {
        reservationId: string; paymentId: string; status: string;
        reservationCount: number; paymentCount: number; activeLockCount: number;
        consumedLockCount: number; collectedTransitionCount: number; readyEventCount: number;
      };
      expect(restartEvidence).toMatchObject({
        reservationId, paymentId: paymentAttempt.paymentId, status: "collected",
        reservationCount: 1, paymentCount: 1, activeLockCount: 0,
        consumedLockCount: 1, collectedTransitionCount: 1, readyEventCount: 1,
      });
      const readyEvent = (await db.query(
        "select payload from public.runtime_outbox_events where aggregate_id=$1 and event_type='reservation.ready.v1'",
        [reservationId],
      )).rows[0].payload as Record<string, unknown>;
      expect(JSON.stringify(readyEvent)).not.toMatch(/pickup|credential|code/i);
      expect((await db.query("select status from public.reservations where id=$1", [reservationId])).rows[0].status).toBe("collected");

      // Provider disagreements are explicit, idempotent, evidence-backed cases.
      await actor(reviewer, "service_role");
      expect((await db.query(
        "select public.apply_payment_provider_event($1,$2,'succeeded',2700,'NGN') value",
        ["network-provider-mismatch", paymentAttempt.providerReference],
      )).rows[0].value.outcome).toBe("rejected_mismatch");
      const orphan = (await db.query(
        "select (public.open_payment_reconciliation_case(null,null,$1,$2,'orphan_provider_transaction',$3::jsonb)).id id",
        ["network-provider-orphan", "provider-orphan-reference", JSON.stringify({ status: "paid", amountMinor: 2500, currency: "NGN" })],
      )).rows[0].id as string;
      expect(orphan).toBeTruthy();
      const linkedCases = (await db.query(
        "select id,reason from public.payment_reconciliation_cases where payment_id=$1 order by reason",
        [paymentAttempt.paymentId],
      )).rows as Array<{ id: string; reason: string }>;
      expect(linkedCases.map(({ reason }) => reason)).toEqual([
        "amount_or_currency_mismatch", "duplicate_provider_transaction",
      ]);
      await actor(reviewer);
      for (const reconciliation of linkedCases) {
        await db.query(
          "select public.resolve_payment_reconciliation_case($1,$2,$3)",
          [reconciliation.id, "Evidence reviewed; canonical completed transaction retained", `provider-evidence://${reconciliation.reason}`],
        );
      }
      expect((await db.query(
        "select reconciliation_required from public.payments where id=$1",
        [paymentAttempt.paymentId],
      )).rows[0].reconciliation_required).toBe(false);

      // Stale evidence remains persisted but removes the same batch from new discovery.
      const staleSourceTime = new Date(now.getTime() - 7_200_000);
      const staleRecordedAt = new Date(now.getTime() + 2_000);
      await actor(applicant);
      await db.query(
        "select public.record_inventory_source_sync($1,$2,'healthy',$3,$4,$5,$6)",
        [approved.organization_id, sourceId, staleSourceTime, staleRecordedAt, "certification://source/network-stale", "network-source-stale"],
      );
      await actor(patient);
      expect((await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows.some(({ inventory_id }) => inventory_id === inventoryId)).toBe(false);
      expect((await db.query("select count(*)::int count from public.inventory_batches where id=$1", [inventoryId])).rows[0].count).toBe(1);
      await actor(applicant);
      const refreshedAt = new Date(now.getTime() + 3_000);
      await db.query(
        "select public.record_inventory_source_sync($1,$2,'healthy',$3,$3,$4,$5)",
        [approved.organization_id, sourceId, refreshedAt, "certification://source/network-refreshed", "network-source-refreshed"],
      );
      await actor(patient);
      expect((await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows.some(({ inventory_id }) => inventory_id === inventoryId)).toBe(true);

      // Suspension blocks new network obligations without rewriting the completed chain.
      await actor(reviewer);
      const activeVersion = (await db.query("select version from public.partner_applications where id=$1", [application.id])).rows[0].version;
      await db.query(
        "select public.transition_partner_relationship($1,'suspend',$2,$3,$4,$5)",
        [application.id, "Controlled convergence suspension", activeVersion, "network-suspend", correlation],
      );
      await actor(patient);
      expect((await db.query(
        "select * from public.discover_marketplace_inventory($1,$2,6.5244,3.3792,25,1,$3)",
        [patientOrganizationId, medicineId, consentId],
      )).rows.some(({ inventory_id }) => inventory_id === inventoryId)).toBe(false);
      expect((await db.query(
        "select status from public.reservations where id=$1",
        [reservationId],
      )).rows[0].status).toBe("collected");
      await denied(
        "insert into public.inventory_locks(organization_id,inventory_organization_id,reservation_id,inventory_batch_id,quantity,idempotency_key,expires_at) values($1,$2,$3,$4,1,$5,now()+interval '5 minutes')",
        [patientOrganizationId, approved.organization_id, reservationId, inventoryId, "network-suspended-lock"],
        /not eligible for a new network reservation/i,
      );

      // Ordinary authenticated SQL remains tenant-isolated. The patient can
      // use the narrow marketplace function, but cannot read or mutate the
      // pharmacy tenant's underlying records.
      await actor(patient);
      await db.query("set local role authenticated");
      expect((await db.query(
        "select count(*)::int count from public.inventory_batches where organization_id in ($1,$2,$3)",
        [approved.organization_id, pharmacyB, pharmacyC],
      )).rows[0].count).toBe(0);
      expect((await db.query(
        "select count(*)::int count from public.partner_applications where organization_id=$1",
        [approved.organization_id],
      )).rows[0].count).toBe(0);
      await denied(
        "update public.inventory_batches set unit_price_minor=1 where id=$1",
        [inventoryId], /permission denied|row-level security/i,
      );
      await db.query("reset role");

      const identity = (await db.query(
        `select application.id partner_application_id,application.organization_id,
          relationship.id partner_relationship_id,$2::uuid pharmacy_id,source.id inventory_source_id,
          batch.id inventory_record_id,batch.medicine_id,reservation.id reservation_id,
          payment.id payment_id,(select id from public.fulfillment_transitions
            where reservation_id=reservation.id and to_state='collected' order by id desc limit 1) fulfillment_id
         from public.partner_applications application
         join public.partner_applications relationship on relationship.id=application.id
         join public.inventory_sources source on source.organization_id=application.organization_id and source.id=$3
         join public.inventory_batches batch on batch.inventory_source_id=source.id and batch.id=$4
         join public.reservations reservation on reservation.id=$5
         join public.payments payment on payment.id=$6
         where application.id=$1`,
        [application.id, locationId, sourceId, inventoryId, reservationId, paymentAttempt.paymentId],
      )).rows[0];
      expect(identity).toMatchObject({
        partner_application_id: application.id,
        organization_id: approved.organization_id,
        pharmacy_id: locationId,
        inventory_source_id: sourceId,
        inventory_record_id: inventoryId,
        medicine_id: medicineId,
        reservation_id: reservationId,
        payment_id: paymentAttempt.paymentId,
      });
      expect(identity.partner_relationship_id).toBe(application.id);
      expect(identity.fulfillment_id).toBeTruthy();
    } finally {
      await db.query("rollback");
      await db.end();
    }
  }, 120_000);
});
