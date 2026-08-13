# RC2 Batch 2 - Pharmacist Review and Pharmacy Inventory

Date: 2026-07-31  
Branch: `rc2-development`  
Authority: MVP Constitution, ADR-0009 and the existing runtime/workflow
contracts

## Status

```text
Source implementation       IMPLEMENTED
Local automated validation  PASS
Runtime validation          PENDING
Certification               BLOCKED
```

The authenticated, verified pharmacist remains the only clinical
decision-maker. ARC performs no clinical approval, medicine substitution or
inventory action.

## Executable slice

```text
protected prescription source
  -> deterministic extraction and findings
  -> pharmacist queue/detail
  -> explicit canonical resolution for every approved item
  -> atomic approve/reject/needs-information decision
  -> protected patient clarification and fresh pharmacist re-review
  -> read-only tenant inventory availability for the resolved medicine
  -> pharmacy-managed canonical stock and immutable movement ledger
```

Patient-facing nearby search and reservation are intentionally excluded; they
belong to Batch 3.

## Clinical boundary

- Queue/detail access uses the existing `prescription:review` permission and
  tenant context resolved by `runApi`.
- Source objects remain private and are exposed through short-lived signed
  references only to the authorized workspace.
- Approval requires every prescription item to resolve to one active canonical
  medicine and all mandatory findings to be acknowledged.
- The database verifies active tenant membership and current pharmacist
  verification, applies resolutions, decides the review, writes audit/outbox
  evidence and creates clarification history in one transaction.
- Corrections are append-only evidence. They never represent autonomous
  substitution.
- Needs-information text stays in an RLS-protected table. A patient response is
  content-bound for idempotency and creates a fresh pending pharmacist review.

## Inventory boundary

- Every inventory batch references `public.medicines(id)`; there is no second
  medicine master.
- `on_hand_quantity >= 0`, `reserved_quantity >= 0`, and
  `reserved_quantity <= on_hand_quantity` are database invariants. Available
  quantity is derived.
- Receive, adjust, reserve, release, dispense, return and expiry are explicit
  atomic commands. Generic metadata updates cannot alter stock totals.
- Every stock command writes an immutable before/after transaction, governance
  audit and versioned outbox event under one transaction and idempotency key.
- Pharmacy owner/staff/inventory manager may perform permitted mutations;
  pharmacist access is read-only; patient management access is denied.
- Availability is ordered FEFO and scoped to active, non-expired stock in the
  requesting organization.

## Entry points

- Pharmacist: `/api/v1/review`, `/api/v1/medicines/search`,
  `/api/v1/inventory/availability`, `/api/v1/inventory`, and
  `/api/v1/dashboard`
- Pharmacy: `/api/v1/inventory`, `/api/v1/inventory/{id}`,
  `/api/v1/inventory/{id}/stock`,
  `/api/v1/inventory/{id}/transactions`, and
  `/api/v1/inventory/availability`
- Patient clarification:
  `/api/v1/prescriptions/{id}/clarifications` and
  `/api/v1/prescriptions/{id}/clarifications/{clarificationId}/response`
- Internal recovery: `/api/internal/inventory-expiry`

All protected entry points use the shared runtime boundary and delegate
persistence to package repositories or database commands.

## Persistence and events

- `202607310020_pharmacy_inventory.sql`
- `202607310021_batch2_review_inventory_integration.sql`
- `prescription.medicine-resolution-recorded.v1`
- `prescription.clarification-responded.v1`
- `inventory.batch-updated.v1`
- `inventory.received.v1`, `inventory.adjusted.v1`,
  `inventory.reserved.v1`, `inventory.released.v1`,
  `inventory.dispensed.v1`, `inventory.returned.v1`,
  `inventory.expired.v1`, and `inventory.low.v1`

Event payloads contain identifiers, bounded operational values and hashes;
they exclude prescription text, clarification text, rationale, credentials and
source media.

## Runtime-validation boundary

Certification requires clean migration apply/recovery and authenticated tests
for two tenants, patient, verified/unverified pharmacist, pharmacy roles and
service role. It must also prove concurrency, optimistic conflict,
idempotency, invariant rejection, signed-source expiry, clarification replay,
expiry recovery and atomic audit/outbox evidence. Static tests do not satisfy
that gate.
