import { describe, expect, it } from "vitest";
import {
  certifyDisasterRecovery,
  certifyRecovery,
} from "./recovery-certification";

describe("backup, restore, and disaster recovery certification", () => {
  it("requires every restore scope plus RPO, RTO, encryption, and checksums", () => {
    const result = certifyRecovery({
      backupId: "backup-1",
      dailyBackup: true,
      hourlyBackup: true,
      pitr: true,
      encrypted: true,
      checksumVerified: true,
      restoreScopes: ["schema", "table", "tenant", "record", "full"],
      recoveryPointMinutes: 30,
      recoveryTimeMinutes: 20,
      requiredRpoMinutes: 60,
      requiredRtoMinutes: 30,
    });
    expect(result).toEqual({ passed: true, failures: [] });
  });

  it("rejects incomplete recovery evidence", () => {
    const result = certifyRecovery({
      backupId: "backup-1",
      dailyBackup: true,
      hourlyBackup: false,
      pitr: false,
      encrypted: false,
      checksumVerified: true,
      restoreScopes: ["schema"],
      recoveryPointMinutes: 90,
      recoveryTimeMinutes: 45,
      requiredRpoMinutes: 60,
      requiredRtoMinutes: 30,
    });
    expect(result.failures).toEqual(expect.arrayContaining([
      "hourly_backup", "pitr", "encryption", "restore_scopes", "rpo", "rto",
    ]));
  });

  it("requires promotion, DNS, recovery, rollback, failback, audit, and RTO", () => {
    const result = certifyDisasterRecovery({
      primaryHealthyBefore: true,
      replicationVerified: true,
      standbyPromoted: true,
      dnsVerified: true,
      serviceRecovered: true,
      rollbackVerified: true,
      failbackVerified: true,
      auditEvidence: true,
      startedAt: new Date("2026-07-30T00:00:00Z"),
      recoveredAt: new Date("2026-07-30T00:20:00Z"),
      requiredRtoMinutes: 30,
    });
    expect(result).toEqual({ passed: true, failures: [] });
  });
});
