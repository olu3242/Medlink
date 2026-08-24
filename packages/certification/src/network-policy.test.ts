import { describe, expect, it } from "vitest";
import {
  evaluateInventoryFreshness,
  reconcilePaymentEvidence,
  suspensionObligationPolicy,
  validateBackupPolicy,
  validateRecoveryPolicy,
} from "./network-policy";

describe("network transaction policies", () => {
  it("evaluates source-specific freshness without a universal TTL", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    const evidence = {
      sourceType: "api" as const,
      sourceUpdatedAt: new Date("2026-08-18T11:45:00Z"),
      lastSuccessfulSync: new Date("2026-08-18T11:46:00Z"),
      integrationHealth: "healthy" as const,
    };
    expect(evaluateInventoryFreshness({
      reference: "approved://inventory/api-test",
      sourceType: "api",
      maxAgeSeconds: 1_800,
      approvedBy: "inventory-owner",
      approvedAt: now,
    }, evidence, now).status).toBe("fresh");
    expect(evaluateInventoryFreshness({
      reference: "approved://inventory/api-test",
      sourceType: "api",
      maxAgeSeconds: 600,
      approvedBy: "inventory-owner",
      approvedAt: now,
    }, evidence, now).status).toBe("stale");
    expect(evaluateInventoryFreshness({
      reference: "approved://inventory/manual-test",
      sourceType: "manual",
      maxAgeSeconds: 600,
      approvedBy: "inventory-owner",
      approvedAt: now,
    }, evidence, now).status).toBe("policy_mismatch");
  });

  it("blocks new obligations after suspension while preserving prior obligations", () => {
    const suspendedAt = new Date("2026-08-18T12:00:00Z");
    expect(suspensionObligationPolicy({
      relationshipState: "suspended",
      obligationCreatedAt: new Date("2026-08-18T11:00:00Z"),
      suspendedAt,
    })).toEqual({ mayCreate: false, preserveExisting: true });
    expect(suspensionObligationPolicy({
      relationshipState: "suspended",
      obligationCreatedAt: null,
      suspendedAt,
    })).toEqual({ mayCreate: false, preserveExisting: false });
  });

  it("requires explicit reconciliation for every uncertain financial case", () => {
    const base = {
      internalPaymentId: "payment-1",
      providerTransactionId: "provider-1",
      providerEventId: "event-1",
      internalState: "pending" as const,
      providerState: "paid" as const,
      reservationActive: true,
      duplicateProviderTransaction: false,
      late: false,
    };
    expect(reconcilePaymentEvidence(base)).toBe("apply_provider_success");
    expect(reconcilePaymentEvidence({ ...base, internalPaymentId: null })).toBe("reconciliation_required");
    expect(reconcilePaymentEvidence({ ...base, duplicateProviderTransaction: true })).toBe("reconciliation_required");
    expect(reconcilePaymentEvidence({ ...base, late: true })).toBe("reconciliation_required");
    expect(reconcilePaymentEvidence({ ...base, reservationActive: false })).toBe("reconciliation_required");
    expect(reconcilePaymentEvidence({
      ...base, internalState: "captured", providerState: "unconfirmed",
    })).toBe("reconciliation_required");
    expect(reconcilePaymentEvidence({
      ...base, internalState: "captured", providerState: "failed",
    })).toBe("reconciliation_required");
  });

  it("does not certify backup policy until owner-approved objectives exist", () => {
    const base = {
      mechanism: "Supabase managed backup plus deployment-controlled export",
      owner: "Database Operations",
      frequency: "deployment-configured schedule",
      retention: "deployment-configured retention",
      restoreProcedure: ["restore into an isolated target"],
      verificationProcedure: ["run migration and transaction invariants"],
      approvedRpoMinutes: null,
      approvedRtoMinutes: null,
    };
    expect(validateBackupPolicy(base)).toEqual(["backup_rpo_rto_owner_decision_required"]);
    expect(validateBackupPolicy({ ...base, approvedRpoMinutes: 60, approvedRtoMinutes: 120 })).toEqual([]);
  });

  it("requires persisted authority for every recovery scenario", () => {
    expect(validateRecoveryPolicy({
      owner: "Platform Operations",
      authoritativeSources: ["database", "outbox", "workflow", "idempotency", "provider_evidence"],
      restartScenarios: [
        "application_restart", "worker_restart", "database_restart",
        "workflow_interruption", "inventory_replay", "payment_callback_replay",
        "notification_retry",
      ],
      replayUsesIdempotencyKeys: true,
      providerEvidenceRequired: true,
      verificationProcedure: ["replay and compare business-effect counts"],
    })).toEqual([]);
  });
});
