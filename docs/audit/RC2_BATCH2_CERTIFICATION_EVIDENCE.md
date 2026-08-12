# RC2 Batch 2 Certification Evidence

Date: 2026-07-31  
Branch: `rc2-development`  
Baseline parent: `d33bd6858e46952083dee4324a16eb90064b816d`  
Scope: `ML-CAP-007`, `ML-CAP-008`, `ML-WF-005`, `ML-WF-008`

## Decision

```text
Source implementation       IMPLEMENTED
Local automated validation  PASS
Runtime validation          PENDING
Pilot certification         BLOCKED
```

Batch 2 is implemented in source. It is not runtime validated or certified
because Docker-backed Supabase, authenticated identities and deployed worker
infrastructure are unavailable in this execution environment.

## Evidence matrix

| Domain | Evidence | Result |
| --- | --- | --- |
| Clinical authority | Verified-pharmacist database gate; explicit per-item canonical resolution; required acknowledgements; no ARC decision authority | Static/unit pass; live authorization pending |
| Clarification | RLS-protected request/response, content-bound idempotency, preserved history and fresh review workflow | Static/unit pass; live transaction/RLS pending |
| Inventory | Catalogue-linked batches, derived availability, bounded metadata and explicit stock operations | Unit/static pass |
| Transaction | Atomic clinical resolution/decision and atomic stock/ledger/audit/outbox commands | Static pass; live failure-injection pending |
| Security | Shared runtime/RBAC, package boundaries, RLS policies, role-checked functions, server-only worker and PHI-safe events | Static pass; live tenant matrix pending |
| Reliability | Optimistic version, advisory idempotency lock, immutable ledger, FEFO projection and bounded expiry recovery | Unit/static pass; live concurrency pending |
| UI | Responsive pharmacist workspace and pharmacy inventory list/detail/operations with loading, empty, error and retry behavior | Build gate pending final checkpoint; authenticated acceptance pending |
| Observability | Runtime correlation/telemetry plus governance audit and versioned transactional events | Source pass; deployed evidence pending |
| Operations | Inventory runbook and Batch 2 risk register | Pass |

## Source chain

- Domain: `packages/clinical/src/review.ts`,
  `packages/clinical/src/dashboard.ts`,
  `packages/inventory/src/management.ts`, and
  `packages/prescription/src/clarification.ts`
- Repositories: `packages/clinical/src/supabase-review.ts`,
  `packages/inventory/src/supabase-inventory.ts`, and
  `packages/prescription/src/supabase-clarification.ts`
- Migrations: `202607310020_pharmacy_inventory.sql` and
  `202607310021_batch2_review_inventory_integration.sql`
- API/UI: pharmacist review/dashboard, pharmacy inventory and patient
  clarification routes/components
- Recovery: `packages/inventory/src/expiry.ts` and
  `/api/internal/inventory-expiry`
- Contracts: `packages/api/src/events.ts` and
  `packages/api/src/professional.ts`
- Specification: `docs/mvp/RC2_BATCH2_REVIEW_INVENTORY.md`
- Operations: `docs/runbooks/pharmacy-inventory.md`
- Risks: `docs/audit/RC2_BATCH2_RISK_REGISTER.md`

## Mandatory representative-environment checks

1. Apply migrations `017` through `021` to a clean isolated RC2 project and
   prove forward recovery.
2. Execute authenticated allow/deny tests across two organizations for patient,
   verified/unverified pharmacist, pharmacy roles and service role.
3. Prove approval fails for unresolved/inactive medicines and succeeds exactly
   once for a fully acknowledged canonical resolution.
4. Prove clarification response replay, cross-patient denial, protected text
   visibility and exactly one fresh review.
5. Prove concurrent receive/adjust/reserve/release/dispense/expiry commands
   preserve invariants, ledger atomicity and idempotency.
6. Prove Pharmacy A cannot read or mutate Pharmacy B inventory and a patient
   cannot invoke management commands.
7. Execute the expiry worker with valid, missing and invalid worker tokens and
   verify bounded recovery plus safe logs.
8. Capture authenticated UI, accessibility, telemetry, audit/outbox and
   operator evidence.

No `CERTIFIED` claim is made until all applicable checks have accepted
evidence.
