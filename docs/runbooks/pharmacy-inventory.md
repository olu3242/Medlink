# Pharmacy Inventory Operations Runbook

Owner: Pharmacy Operations  
Applies to: RC2 Batch 2 inventory  
Status: Approved source procedure; runtime rehearsal pending

## Purpose and scope

Operate catalogue-linked pharmacy stock safely, investigate invariant or
worker failures, and recover without editing stock totals directly. This
runbook covers receive, adjust, dispense, return, price/status metadata, low
stock, expiry and reconciliation. Reservation and pickup procedures remain a
Batch 3 concern.

## Prerequisites and permissions

- Confirm the actor has active organization membership and the applicable
  `inventory:read` or `inventory:manage` permission.
- Confirm the pharmacy location belongs to the current organization and the
  selected canonical medicine is active.
- Capture correlation ID, reason/reference, expected batch version and a unique
  idempotency key before mutation.
- The expiry endpoint requires service-role database access and a dedicated
  server-only `MEDLINK_INVENTORY_WORKER_TOKEN`. Never paste token values into
  tickets, commands, logs or screenshots.

## Routine procedures

### Receive stock

1. Search and select the active canonical medicine.
2. Select the organization-owned location and record batch number, expiry,
   quantity, unit and permitted sale price/currency.
3. Submit `receive` once with the captured idempotency/correlation context.
4. Verify on-hand and available totals, one immutable `receive` transaction,
   audit evidence and `inventory.received.v1` outbox event.

### Adjust, dispense or return

1. Open the inventory detail and confirm medicine, batch, location, current
   totals and version.
2. Select the explicit operation. Record a bounded operational reason and
   reference.
3. Submit with the displayed expected version and a new idempotency key.
4. Verify the before/after ledger entry and derived availability. A stale
   version or invariant violation must fail without a partial ledger/event.

### Update price or status

1. Confirm price and ISO currency are supplied together or both cleared.
2. Submit metadata with optimistic version; do not use a stock operation.
3. Verify `inventory.price-update` or `inventory.update` audit evidence and
   `inventory.batch-updated.v1`.

### Expiry recovery

1. Invoke the protected expiry worker on the approved schedule with a bounded
   batch limit.
2. Verify each expired active batch receives one expiry movement and becomes
   unavailable; replay must not double-apply it.
3. Repeat until the response reports no remaining eligible rows.
4. Investigate authorization failure, queue age or repeated retry before
   increasing the batch limit.

## Incident and validation checks

- For negative/over-reserved totals, stop affected operations immediately;
  capture safe identifiers and correlation IDs; do not repair with direct SQL.
- Reconcile the batch against the immutable transaction sum, audit event and
  outbox event. Escalate any mismatch as a release-blocking integrity incident.
- For a stale-version response, reload and intentionally reassess; never retry
  a changed command under the old key.
- For cross-tenant or unexpected patient access, preserve safe audit evidence,
  revoke exposed sessions if required and engage Security.
- For worker-token exposure, disable the schedule, rotate the token through the
  approved secret store, validate denial of the old token and resume with a
  canary.

## Rollback and recovery

Inventory transactions are immutable and must not be deleted or rewritten.
Correct an operational error with an authorized compensating adjustment or
return that references the original transaction. Code/database rollback uses
the release rollback procedure; forward migrations and reconciliation are
preferred because migrations `020`/`021` add protected evidence structures.

## Required evidence

Record environment, release/tag, organization/location/inventory identifiers,
operator membership, timestamps, correlation/idempotency keys, before/after
totals, ledger/audit/outbox identifiers, outcome and approver. Exclude patient
content, prescription images, rationale, credentials and secret values.
