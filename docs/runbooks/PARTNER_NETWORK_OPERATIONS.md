# Partner Network operations runbooks

These runbooks preserve domain authority. Never fix an operational symptom by directly rewriting partner, inventory, reservation, payment, fulfillment, workflow, or outbox tables.

## Inventory sync failure

- Symptom: location readiness reports `inventory_integration_unhealthy`, `inventory_not_current`, or `inventory_freshness_policy_required`.
- Inspect: Partner location capability evidence, source health, timestamps, mapping state, and inventory transactions.
- Safe remediation: restore the source; replay the idempotent ingestion job; submit new verified capability evidence; confirm canonical availability.
- Unsafe: marking network ready, rewriting quantity, or resolving ambiguous medicine identity by hand.
- Escalate: inventory owner, then medication-governance reviewer for ambiguous mappings.
- Verify: failed location disappears from new discovery; healthy locations and existing obligations remain unchanged.

## Payment reconciliation

- Symptom: MedLink and provider states disagree, callback is late/duplicate, or a refund is pending.
- Inspect: canonical payment obligation, attempts, signed provider events, reservation state, refund outbox, correlation ID.
- Safe remediation: verify provider evidence; replay the signed/idempotent webhook or refund dispatcher; leave uncertain truth visible.
- Unsafe: direct paid/refunded updates, duplicate initiation, or reservation mutation to force agreement.
- Escalate: payment operator and finance owner.
- Verify: one obligation, deterministic final state, matching provider reference, complete audit/outbox trail.

## Notification outage

- Symptom: transaction state advanced but notification remains pending/retrying/dead-lettered.
- Inspect: runtime outbox state, delivery attempts, provider health, recipient routing, and safe template.
- Safe remediation: restore provider; replay the dispatcher; use an approved alternate channel.
- Unsafe: rolling back READY/payment/collection, including pickup credentials, or editing transactional state.
- Escalate: communications operator; security if content or recipient is wrong.
- Verify: deduplicated delivery and unchanged business state.

## Partner suspension

- Symptom: legal/compliance/operational evidence requires new network participation to stop.
- Inspect: relationship status, reviewer reason, location network state, open reservations/payments/fulfillments.
- Safe remediation: platform-admin suspension with a meaningful reason; confirm all Partner-era locations leave discovery; govern existing obligations individually.
- Unsafe: applicant self-suspension, direct status update, blanket cancellation, inventory deletion, or payment reversal.
- Escalate: Partner governance plus clinical/financial owner where obligations exist.
- Verify: `partner_not_active` blocks new discovery; audit/outbox evidence exists; existing obligations retain their authoritative states.

## Location outage

- Symptom: one location loses credential, inventory, payment, or fulfillment capability.
- Inspect: location active flag, capability evidence, source health, inventory, open obligations.
- Safe remediation: record failed/degraded evidence for that location; restore dependency; re-verify evidence.
- Unsafe: suspend the whole partner automatically or mark a different location unhealthy.
- Escalate: pharmacy owner and affected integration owner.
- Verify: only the affected location is excluded and multi-location peers remain eligible.

## Reservation stuck

- Symptom: reservation remains pending/confirmed past expected progression.
- Inspect: reservation timeline, inventory lock, payment obligation, expiry eligibility, workflow/outbox correlation.
- Safe remediation: use canonical decision, expiry, refund, or replay commands with the same idempotency key as appropriate.
- Unsafe: deleting locks, decrementing inventory, or skipping payment/fulfillment transitions.
- Escalate: pharmacy operations; payment owner if financial truth is uncertain.
- Verify: inventory arithmetic, single final transition, audit event, and safe notification.

## Workflow replay

- Symptom: persisted domain state exists but a downstream handler did not finish.
- Inspect: originating domain record first, then workflow instance, outbox status, retry/dead-letter evidence, correlation ID.
- Safe remediation: restore dependency and replay the idempotent event/job.
- Unsafe: changing domain truth to match workflow context or replaying with a new business identifier.
- Escalate: owning domain if evidence conflicts; platform runtime for dispatcher failure.
- Verify: one business effect, completed/visible workflow state, no duplicate payment/inventory/notification effect.

## Database recovery

- Symptom: database unavailable, restart incomplete, or restore validation requested.
- Inspect: provider/database health, migration ledger, backups, replication/restore status, application health.
- Safe remediation: follow the deployment provider's approved recovery procedure; apply forward-compatible migrations; run invariant and golden-loop probes.
- Unsafe: automatic destructive rollback, restoring over an unverified target, editing migration history, or claiming recovery from local reset evidence.
- Escalate: database owner and incident commander.
- Verify: partner identity continuity, location/inventory, medicines, reservations, payments, fulfillment, audit/outbox, and workflow persistence.

Production backup/restore and rollback remain blocked until deployment-specific policies and executable evidence are supplied (`BACKUP_POLICY_REQUIRED`, `RECOVERY_POLICY_REQUIRED`).
