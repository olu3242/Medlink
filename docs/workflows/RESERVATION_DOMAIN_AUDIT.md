# Reservation Domain Audit

## Verdict

The atomic creation command is authoritative and substantially correct. The
gateway patient creation and pharmacy confirmation/decline surfaces are now
harmonized with it. Reservation creation and pharmacy decision are
`IMPLEMENTED` and source-tested, but remain `PARTIAL` for certification because
live database/auth execution is blocked. Ready, collect, and expiry remain
`MISSING` at the executable API/persistence boundary.

## Artifact inventory

| Layer | Artifact | Finding |
| --- | --- | --- |
| Legacy patient UI | `apps/patient/app/reserve/[inventoryId]/page.tsx` | Sends only `inventoryId`; incompatible and must be retired |
| Gateway search UI | `apps/web/app/(portals)/patient/search/page.tsx` | Carries canonical batch, medicine, and pharmacy-location identity into a matched-MAR reservation form |
| API creation | `apps/patient/app/api/v1/reservations/route.ts` | Validates the complete command and derives idempotency only from the required header |
| Application | `AccessApplication.reserve()` | Correctly delegates to the atomic RPC |
| Atomic RPC | `reserve_inventory` | Validates actor, tenant, matched MAR, batch/location, availability, quantity, expiry, replay payload; atomically inserts reservation/lock, transitions MAR, and records evidence |
| Tables | `reservations`, `inventory_locks` | Canonical status and lock invariants exist |
| Professional contract | `packages/api/src/professional.ts` | Defines `ready` and `collect`; no confirmation/decline decision |
| Gateway pharmacy UI | `apps/web/app/(portals)/pharmacy/reservations/page.tsx` | Lists the canonical queue and sends confirmation/decline through the registered decision route |
| Fulfillment domain | `FulfillmentCoordinator` | Defines reserve/ready/collect/compensate in memory-facing ports, not database/API binding |
| Persistence | `fulfillment_transitions` | `decide_reservation` appends decision history atomically with state/lock/evidence changes |
| Events | `packages/api/src/events.ts` | Created, confirmed, cancelled, ready, and collected contracts exist |
| Notifications | notification domain/outbox | Infrastructure exists; no decision command schedules a reservation outcome notification |

## Canonical creation command

The public command contains `marId`, `pharmacyLocationId`,
`inventoryBatchId`, `quantity`, and `expiresAt`. Idempotency is the
`Idempotency-Key` header; actor, organization/tenant, requester, correlation,
channel, and locale come only from trusted runtime context. Medicine and patient
identity are derived and validated from the MAR/batch, preventing contradictory
client assertions.

## State machine

```text
matched MAR -> pending reservation + active lock -> confirmed
                                             |       |
                                             |       v
                                             |     ready -> collected + consumed lock
                                             v
                                          cancelled + released lock
pending/confirmed/ready -> expired + released lock
```

Confirmation and decline are pharmacy decisions. `ready` is not a synonym for
confirmation: it asserts that pickup preparation is complete. Collection
consumes the lock. Decline maps to the canonical terminal `cancelled` status
with an explicit reason; a new `declined` database state is unnecessary.

## Required closure

1. Execute the complete migration chain and decision flow against live PostgreSQL.
2. Add live database tests for concurrency, replay, authorization, and rollback.
3. Implement ready/collect RPC bindings after the decision gate.
4. Implement and exercise expiry scheduling and recovery.
5. Bind notification delivery and realtime UI convergence to committed events.

No compatibility endpoint or one-field payload is permitted.
