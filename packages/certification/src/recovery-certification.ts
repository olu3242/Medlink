export type RestoreScope =
  | "schema"
  | "table"
  | "tenant"
  | "record"
  | "full";

export interface RecoveryEvidence {
  readonly backupId: string;
  readonly dailyBackup: boolean;
  readonly hourlyBackup: boolean;
  readonly pitr: boolean;
  readonly encrypted: boolean;
  readonly checksumVerified: boolean;
  readonly restoreScopes: readonly RestoreScope[];
  readonly recoveryPointMinutes: number;
  readonly recoveryTimeMinutes: number;
  readonly requiredRpoMinutes: number;
  readonly requiredRtoMinutes: number;
}

export function certifyRecovery(evidence: RecoveryEvidence): {
  readonly passed: boolean;
  readonly failures: readonly string[];
} {
  const requiredScopes: readonly RestoreScope[] = [
    "schema", "table", "tenant", "record", "full",
  ];
  const checks: Readonly<Record<string, boolean>> = {
    daily_backup: evidence.dailyBackup,
    hourly_backup: evidence.hourlyBackup,
    pitr: evidence.pitr,
    encryption: evidence.encrypted,
    checksum: evidence.checksumVerified,
    restore_scopes: requiredScopes.every((scope) =>
      evidence.restoreScopes.includes(scope)
    ),
    rpo: evidence.recoveryPointMinutes <= evidence.requiredRpoMinutes,
    rto: evidence.recoveryTimeMinutes <= evidence.requiredRtoMinutes,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return { passed: failures.length === 0, failures };
}

export interface DisasterRecoveryEvidence {
  readonly primaryHealthyBefore: boolean;
  readonly replicationVerified: boolean;
  readonly standbyPromoted: boolean;
  readonly dnsVerified: boolean;
  readonly serviceRecovered: boolean;
  readonly rollbackVerified: boolean;
  readonly failbackVerified: boolean;
  readonly auditEvidence: boolean;
  readonly startedAt: Date;
  readonly recoveredAt: Date;
  readonly requiredRtoMinutes: number;
}

export function certifyDisasterRecovery(
  evidence: DisasterRecoveryEvidence,
): { readonly passed: boolean; readonly failures: readonly string[] } {
  const recoveryMinutes =
    (evidence.recoveredAt.getTime() - evidence.startedAt.getTime()) / 60_000;
  const checks: Readonly<Record<string, boolean>> = {
    primary: evidence.primaryHealthyBefore,
    replication: evidence.replicationVerified,
    promotion: evidence.standbyPromoted,
    dns: evidence.dnsVerified,
    recovery: evidence.serviceRecovered,
    rollback: evidence.rollbackVerified,
    failback: evidence.failbackVerified,
    audit: evidence.auditEvidence,
    rto: recoveryMinutes >= 0 && recoveryMinutes <= evidence.requiredRtoMinutes,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return { passed: failures.length === 0, failures };
}
