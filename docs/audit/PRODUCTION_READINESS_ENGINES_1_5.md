# Production Readiness Engines 1–5

Date: 2026-07-30

## Engine 1 — Identity and tenant certification

- Certifies active tenant lifecycle and organization ownership.
- Requires current, unique, verified identities from trusted clients.
- Supports pharmacist, provider, patient, service-account, API-client, and
  device evidence.
- Enforces provisioning, verification, activation, suspension, and
  reactivation transitions.
- JWT and session checks fail closed.

## Engine 2 — Production secrets certification

- Validates required production-secret presence, external storage source,
  validation state, expiry, and rotation deadlines.
- Rejects duplicate, missing, invalid, unverified, expired, overdue, leaked, or
  repository-plaintext credentials.
- Reports credentials expiring within seven days.

## Engine 3 — External provider certification

- Supports required production profiles for email, messaging, payment, storage,
  maps, and AI providers.
- Requires current external evidence for connectivity, authentication,
  timeouts, retries, circuit breaking, fallback, and audit logging.
- Distinguishes missing provider profiles from failed controls.

## Engine 4 — Backup and restore certification

- Requires daily and hourly backup evidence, PITR, encryption, checksums, and
  schema/table/tenant/record/full restore scopes.
- Enforces configured RPO and RTO thresholds.

## Engine 5 — Disaster recovery certification

- Requires primary baseline health, replication, standby promotion, DNS,
  service recovery, rollback, failback, audit evidence, and RTO.

## Validation

- `npm run check`: pass
- 221 source tests pass; 8 credential-gated hosted tests skip locally
- The hosted tests execute in GitHub Actions using approved repository secrets

## Certification status

**SOURCE GATES PASS / PRODUCTION EVIDENCE CONDITIONAL**

These engines evaluate supplied evidence and do not synthesize provider,
backup, DR, identity, or approval artifacts. Production PASS requires current
environment evidence for each configured policy.
