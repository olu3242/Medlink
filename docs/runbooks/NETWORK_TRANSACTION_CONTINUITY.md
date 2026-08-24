# Network transaction continuity policy

This policy governs new Partner-generated pharmacy transactions. It does not
declare production readiness or replace domain authority.

## Inventory freshness

Inventory freshness is source-specific. An approved
`inventory_freshness_policies` row binds one `inventory_source_type` to an
owner-approved `max_age_seconds`, approval evidence, and effective window.
MedLink supplies no universal default duration.

Every source synchronization appends an `inventory_source_sync_events` row.
The latest healthy event determines the source deadline. Stale, failed, or
never-synchronized sources and batches remain persisted and tenant-auditable,
but `search_inventory_availability`, patient RLS, and the inventory-lock
trigger exclude them from new discovery and reservation.

Certification-only policy references and durations must use a
`certification://` reference. They are not deployable production policy.

## Partner suspension obligations

`ACTIVE -> SUSPENDED` removes all Partner-era locations from new discovery and
causes new reservation locks to fail closed. Suspension does not update or
delete reservations, inventory locks, payments, fulfillment transitions, or
notifications. Existing obligations continue under their authoritative domain
lifecycle until an authorized domain action changes them.

## Payment reconciliation

Signed provider evidence is authoritative for external settlement. MedLink
retains its internal state and records disagreement in
`payment_reconciliation_cases`.

Cases include internal/provider disagreement, duplicates, orphans, late
success, late failure, success after reservation expiry, and amount/currency
mismatch. Provider ingestion is service-role-only. Resolution is
platform-administrator-only, requires an evidence reference, is idempotent,
and writes governance audit evidence. No reconciliation path invents provider
success or silently edits reservation/fulfillment truth.

## Backup policy

The deployed database authority is Supabase Postgres. The deployment owner
must record all of the following before backup policy can pass:

- enabled Supabase backup/PITR mechanism and any deployment-controlled export;
- named Database Operations owner and incident escalation path;
- configured backup frequency and retention for the actual Supabase plan;
- owner-approved RPO and RTO;
- encryption/key ownership and access controls;
- an isolated-target restore procedure;
- checksum, migration-ledger, RLS, identity-chain, and golden-loop verification;
- the date and evidence reference of the latest successful restore exercise.

Provider feature availability is not evidence that MedLink backup or restore
has been tested. Repository-local `supabase db reset` proves migration replay,
not production backup recovery.

Current deployment decision gate:
`BACKUP_RPO_RTO_REQUIRE_OWNER_DECISION`. Values must come from the deployment
owner; this repository intentionally does not fabricate them.

## Recovery policy

Critical state recovers from Postgres, append-only audit/event rows, durable
workflow state, outbox records, idempotency keys, and verified provider
evidence—never process memory.

| Scenario | Authoritative recovery action | Required verification |
| --- | --- | --- |
| Application restart | Re-read transaction and workflow state | Identity chain and state unchanged |
| Worker restart | Reclaim eligible persisted work | One business effect after replay |
| Database restart | Reconnect after database health returns | Migration ledger and persisted chain intact |
| Workflow interruption | Replay the same checkpoint/event | No domain authority override |
| Inventory replay | Reuse source and idempotency evidence | Quantity and transaction ledger unchanged except intended effect |
| Payment callback replay | Verify signature and provider event ID | One payment business effect; disagreement becomes a case |
| Notification retry | Reclaim outbox event with the same key | Correct recipient/template, no credential content, no duplicate delivery effect |

Recovery certification requires measured restart/replay evidence. A runbook or
provider capability alone is insufficient.

## Operator verification

1. Verify the Partner relationship and derived location blockers.
2. Verify the source policy, latest sync evidence, and computed deadline.
3. Verify the batch remains present when stale and is absent from discovery.
4. Verify a new lock is rejected while stale or suspended.
5. Verify pre-existing reservations/payments/fulfillment rows were not rewritten.
6. For payment disagreement, verify the signed event, case, authorized
   resolution, audit row, and idempotent replay.
7. For recovery, compare inventory, payment, fulfillment, notification, and
   collection business-effect counts before and after restart.
