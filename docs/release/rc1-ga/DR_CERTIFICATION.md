# RC1 Backup and Disaster-Recovery Certification

Date: 2026-07-30  
Baseline: `45bc75f13245fcc37c0fa17b7b895c3667be7f64`  
Decision: **NOT CERTIFIED**

## Available evidence

| Capability | Result |
| --- | --- |
| Clean migration reset | PASS |
| Non-empty schema export | PASS |
| Required runtime-outbox schema presence | PASS |
| SHA-256 schema export | PASS |
| Byte-identical schema reconstruction across two resets | PASS |
| Recovery contracts and runbook registry | Source PASS |

## Missing mandatory evidence

| Exercise | Required artifact |
| --- | --- |
| Managed encrypted backup | Provider backup identifier, timestamp, encryption and retention evidence |
| Point-in-time recovery | Selected recovery point, measured RPO, recovered transaction boundary |
| Isolated data restore | Restore log, row/object counts, checksums, application validation |
| Tenant recovery | Authorized tenant scope, isolation proof, record integrity |
| Configuration and secret recovery | Vault/version references and controlled recovery validation |
| Regional failover/failback | Timeline, health evidence, data consistency, operator acceptance |
| Provider outage recovery | Queue preservation, recovery, reconciliation, acceptance |
| RTO/RPO approval | Measured values compared with approved objectives |

Deterministic schema reconstruction does not prove recoverability of production
data. Until the exercises above are executed and approved, backup/DR remains a
hard GA blocker.

